// agents/base-agent.js
// Automatiza Claude.ai web usando Playwright

const { chromium } = require('playwright');
const fs = require('fs-extra');
const path = require('path');

class ClaudeWebAgent {
  constructor({ name, role, persona, credentials, sessionDir = './sessions', headless = false, slowMo = 100, userDataDir = null }) {
    this.name = name;
    this.role = role;
    this.persona = persona;
    this.credentials = credentials;
    this.sessionDir = sessionDir;
    this.headless = headless;
    this.slowMo = slowMo;
    this.userDataDir = userDataDir;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.initialized = false;
    this.conversationStarted = false;
    this.eventHandlers = {};
    this.timeout = 180000; // 3 min timeout para respuestas largas
  }

  on(event, handler) {
    this.eventHandlers[event] = handler;
  }

  emit(event, data) {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event](data);
    }
  }

  log(message, level = 'info') {
    const timestamp = new Date().toISOString();
    const logEntry = { timestamp, agent: this.name, role: this.role, level, message };
    this.emit('log', logEntry);
    console.log(`[${timestamp}] [${this.role}] ${message}`);
  }

  async initialize() {
    this.log('Iniciando navegador...');
    await fs.ensureDir(this.sessionDir);
    
    // Si se configura userDataDir, usar contexto persistente compartiendo perfil
    if (this.userDataDir) {
      this.log(`Usando contexto persistente en: ${this.userDataDir}`);
      this.context = await chromium.launchPersistentContext(this.userDataDir, {
        headless: this.headless,
        slowMo: this.slowMo,
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      });
      this.browser = this.context;
    } else {
      const sessionFile = path.join(this.sessionDir, `${this.role}-session.json`);
      const hasSession = await fs.pathExists(sessionFile);

      this.browser = await chromium.launch({
        headless: this.headless,
        slowMo: this.slowMo,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });

      // Restaurar sesión si existe
      const contextOptions = {
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      };

      if (hasSession) {
        try {
          const sessionData = await fs.readJson(sessionFile);
          contextOptions.storageState = sessionData;
          this.log('Sesión anterior encontrada, restaurando...');
        } catch (e) {
          this.log('Error cargando sesión, haciendo login nuevo...', 'warn');
        }
      }

      this.context = await this.browser.newContext(contextOptions);
    }
    this.page = await this.context.newPage();
    
    // Suprimir diálogos
    this.page.on('dialog', dialog => dialog.accept());

    await this.login();
    await this.saveSession();
    
    this.initialized = true;
    this.emit('ready', { agent: this.name, role: this.role });
    this.log(`Agente ${this.name} listo`);
  }

  async login() {
    this.log('Navegando a claude.ai...');
    await this.page.goto('https://claude.ai', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.page.waitForTimeout(2000);

    // Verificar si ya está logueado
    const isLoggedIn = await this.checkIfLoggedIn();
    if (isLoggedIn) {
      this.log('Sesión activa detectada, no es necesario hacer login');
      return;
    }

    this.log('Realizando login en Claude.ai...');
    
    try {
      // Buscar botón de login
      await this.clickElement([
        'a[href*="login"]',
        'button:has-text("Log in")',
        'a:has-text("Log in")',
        '[data-testid="login-button"]'
      ]);
      
      await this.page.waitForTimeout(2000);
      
      // Email
      const emailInput = await this.waitForElement([
        'input[type="email"]',
        'input[name="email"]',
        'input[placeholder*="email" i]'
      ]);
      await emailInput.fill(this.credentials.email);
      
      // Continuar
      await this.clickElement([
        'button:has-text("Continue")',
        'button[type="submit"]',
        'input[type="submit"]'
      ]);
      
      await this.page.waitForTimeout(2000);

      const pwd = (this.credentials?.password && String(this.credentials.password).trim()) || '';

      // Sin contraseña: flujo típico de Claude = enlace mágico al correo (no automatizable al 100%).
      if (!pwd) {
        this.log(
          'Sin contraseña en configuración: se asume login por enlace mágico. Revisa tu email y/o completa el acceso en el navegador.',
          'info'
        );
        this.emit('action_required', {
          agent: this.name,
          message:
            'Claude puede enviarte un enlace al email. Ábrelo y confirma; si hace falta, termina el login en esta ventana del navegador (hasta 5 min).'
        });
        await this.waitForLoggedIn(300000);
        this.log('Login exitoso');
        return;
      }

      // Password (cuentas que usan contraseña tras el email)
      try {
        const passwordInput = await this.waitForElement(
          ['input[type="password"]', 'input[name="password"]'],
          5000
        );

        if (passwordInput) {
          await passwordInput.fill(pwd);
          await this.clickElement(['button:has-text("Continue")', 'button[type="submit"]']);
        }
      } catch (e) {
        this.log('Puede que se haya enviado un email de verificación. Revisa tu correo.', 'warn');
        this.emit('action_required', {
          agent: this.name,
          message: 'Se requiere verificación por email. Completa el login manualmente en el navegador.'
        });
        await this.waitForLoggedIn(300000);
      }

      await this.waitForLoggedIn();
      this.log('Login exitoso');
      
    } catch (error) {
      this.log(`Error en login: ${error.message}`, 'error');
      this.emit('action_required', {
        agent: this.name,
        message: `Por favor completa el login manualmente en el navegador para ${this.role}`,
        error: error.message
      });
      await this.waitForLoggedIn(300000);
    }
  }

  async checkIfLoggedIn() {
    try {
      const url = this.page.url();
      if (url.includes('/new') || url.includes('/chat') || url.includes('claude.ai')) {
        // Buscar elementos que indiquen sesión activa
        const indicators = await this.page.$$('[data-testid*="user"], .user-menu, [aria-label*="Account"], nav a[href*="settings"]');
        return indicators.length > 0;
      }
    } catch (e) {}
    return false;
  }

  async waitForLoggedIn(timeout = 30000) {
    this.log('Esperando login completado...');
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      await this.page.waitForTimeout(2000);
      if (await this.checkIfLoggedIn()) {
        return true;
      }
      const url = this.page.url();
      if (url.includes('claude.ai') && !url.includes('login') && !url.includes('auth')) {
        return true;
      }
    }
    throw new Error('Timeout esperando login');
  }

  async saveSession() {
    // Con contexto persistente no tiene sentido guardar storageState manualmente
    if (this.userDataDir) return;
    try {
      await fs.ensureDir(this.sessionDir);
      const sessionFile = path.join(this.sessionDir, `${this.role}-session.json`);
      const storageState = await this.context.storageState();
      await fs.writeJson(sessionFile, storageState);
      this.log('Sesión guardada');
    } catch (e) {
      this.log(`Error guardando sesión: ${e.message}`, 'warn');
    }
  }

  async startNewConversation() {
    this.log('Iniciando nueva conversación...');
    
    // Navegar a nueva conversación
    await this.page.goto('https://claude.ai/new', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.page.waitForTimeout(2000);
    
    this.conversationStarted = false;
    this.log('Nueva conversación lista');
  }

  async sendMessage(message, isFirstMessage = false) {
    const fullMessage = isFirstMessage && this.persona 
      ? `${this.persona}\n\n---\n\n${message}`
      : message;

    this.log(`Enviando mensaje (${fullMessage.length} chars)...`);
    this.emit('sending', { agent: this.name, preview: message.substring(0, 100) });

    // Encontrar y rellenar el input
    const input = await this.waitForElement([
      '[contenteditable="true"]',
      'div[contenteditable]',
      'textarea[placeholder*="message" i]',
      'div[role="textbox"]'
    ]);

    // Click para enfocar
    await input.click();
    await this.page.waitForTimeout(500);
    
    // Limpiar y escribir - usar clipboard para textos largos
    if (fullMessage.length > 1000) {
      await this.page.evaluate((text) => {
        navigator.clipboard.writeText(text).catch(() => {});
      }, fullMessage);
      await input.click({ clickCount: 3 });
      await this.page.keyboard.press('Control+a');
      await this.page.keyboard.press('Control+v');
      await this.page.waitForTimeout(1000);
    } else {
      // Limpiar campo actual
      await this.page.keyboard.press('Control+a');
      await this.page.keyboard.type(fullMessage, { delay: 10 });
    }

    await this.page.waitForTimeout(500);

    // Enviar con Enter (o buscar botón de envío)
    try {
      const sendBtn = await this.page.$('[aria-label="Send message"], button[type="submit"]:near(input), button:has-text("Send")');
      if (sendBtn) {
        await sendBtn.click();
      } else {
        await this.page.keyboard.press('Enter');
      }
    } catch (e) {
      await this.page.keyboard.press('Enter');
    }

    this.log('Mensaje enviado, esperando respuesta...');
    const response = await this.waitForResponse();
    this.conversationStarted = true;
    
    return response;
  }

  async waitForResponse() {
    const startTime = Date.now();
    
    // Esperar que aparezca indicador de "thinking/streaming"
    try {
      await this.page.waitForSelector([
        '[data-is-streaming="true"]',
        '.streaming',
        '[aria-label*="Claude is thinking"]',
        '.animate-spin'
      ].join(', '), { timeout: 15000 });
    } catch (e) {
      // Puede que ya haya terminado
    }

    // Esperar que DESAPAREZCA el indicador de streaming
    this.log('Claude está procesando...');
    
    let waitAttempts = 0;
    const maxWait = this.timeout / 2000;
    
    while (waitAttempts < maxWait) {
      await this.page.waitForTimeout(2000);
      waitAttempts++;
      
      const isStreaming = await this.page.evaluate(() => {
        // Buscar indicadores de streaming activo
        const streamingEl = document.querySelector('[data-is-streaming="true"]');
        const spinners = document.querySelectorAll('.animate-spin, [aria-label*="thinking"]');
        const stopBtn = document.querySelector('[aria-label="Stop generating"], button:has-text("Stop")');
        return !!streamingEl || !!stopBtn || spinners.length > 0;
      });

      if (!isStreaming) {
        this.log(`Respuesta recibida en ${waitAttempts * 2}s`);
        break;
      }

      if (Date.now() - startTime > this.timeout) {
        this.log('Timeout esperando respuesta', 'warn');
        break;
      }
    }

    await this.page.waitForTimeout(1000); // Buffer extra

    // Extraer la última respuesta
    const response = await this.extractLastResponse();
    return response;
  }

  async extractLastResponse() {
    const response = await this.page.evaluate(() => {
      // Buscar todos los mensajes del asistente
      const selectors = [
        '[data-testid="assistant-message"]',
        '.claude-message',
        '[data-message-author-role="assistant"]',
        'div[class*="assistant"] .prose',
        '.message-content'
      ];
      
      let messages = [];
      for (const selector of selectors) {
        messages = Array.from(document.querySelectorAll(selector));
        if (messages.length > 0) break;
      }
      
      if (messages.length === 0) {
        // Fallback: buscar por estructura DOM
        const allMessages = document.querySelectorAll('[class*="message"], [class*="response"]');
        messages = Array.from(allMessages).filter(el => {
          const text = el.textContent.trim();
          return text.length > 50;
        });
      }
      
      if (messages.length === 0) return null;
      
      const lastMessage = messages[messages.length - 1];
      return lastMessage ? lastMessage.textContent.trim() : null;
    });

    if (!response) {
      this.log('No se pudo extraer respuesta, usando DOM alternativo', 'warn');
      return await this.fallbackExtract();
    }

    this.emit('response', { agent: this.name, preview: response.substring(0, 200) });
    return response;
  }

  async fallbackExtract() {
    // Extraer todo el texto visible y tomar la última parte significativa
    const text = await this.page.evaluate(() => {
      const main = document.querySelector('main');
      return main ? main.innerText : document.body.innerText;
    });
    
    const lines = text.split('\n').filter(l => l.trim().length > 20);
    const lastChunk = lines.slice(-50).join('\n');
    return lastChunk;
  }

  async waitForElement(selectors, timeout = 15000) {
    const combined = Array.isArray(selectors) ? selectors.join(', ') : selectors;
    return await this.page.waitForSelector(combined, { timeout });
  }

  async clickElement(selectors) {
    const combined = Array.isArray(selectors) ? selectors.join(', ') : selectors;
    const el = await this.waitForElement(combined);
    await el.click();
    await this.page.waitForTimeout(500);
  }

  async close() {
    await this.saveSession();
    if (this.browser) {
      await this.browser.close();
    }
    this.log('Agente cerrado');
  }

  // Método auxiliar para extraer JSON de la respuesta (incl. ```json ... ``` y objetos anidados)
  parseJSONResponse(text) {
    const { parseLlmJsonResponse } = require('../lib/parse-llm-json');
    try {
      const parsed = parseLlmJsonResponse(text);
      if (parsed != null) return parsed;
    } catch (e) {
      this.log(`Error parseando JSON: ${e.message}`, 'warn');
    }
    if (text && String(text).trim()) {
      this.log('No se pudo extraer JSON válido del texto del modelo (revisa fences ``` o JSON mal formado)', 'warn');
    }
    return null;
  }
}

module.exports = ClaudeWebAgent;
