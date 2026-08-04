const { app, BrowserWindow, dialog, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let mainWindow;
let backendProcess;

/**
 * 获取后端可执行文件路径
 * 开发环境：直接使用 dist/main.js
 * 生产环境：使用打包后的 backend/main.exe
 */
function getBackendPath() {
  const isDev = process.env.NODE_ENV === 'development';

  if (isDev) {
    return {
      cmd: 'node',
      args: [path.join(__dirname, '../../backend/dist/main.js')],
      cwd: path.join(__dirname, '../../backend'),
    };
  }

  // 生产环境：从 resources 目录读取
  const resourcesPath = process.resourcesPath;
  const backendDir = path.join(resourcesPath, 'backend');

  // 优先使用打包内自带的 Node 运行时（CI 注入到 backend/node_modules/node[.exe]），
  // 这样分发给同事的安装包无需对方预装 Node。本地未注入时回退系统 Node。
  const nodeName = process.platform === 'win32' ? 'node.exe' : 'node';
  const bundledNode = path.join(backendDir, 'node_modules', nodeName);
  if (fs.existsSync(bundledNode)) {
    return { cmd: bundledNode, args: [path.join(backendDir, 'main.js')], cwd: backendDir };
  }

  // 兼容旧逻辑：若将来产出打包后的 main.exe 则优先
  if (process.platform === 'win32') {
    const exePath = path.join(backendDir, 'main.exe');
    if (fs.existsSync(exePath)) {
      return { cmd: exePath, args: [], cwd: backendDir };
    }
  }

  // 回退：用系统 PATH 上的 node 运行 js
  return {
    cmd: 'node',
    args: [path.join(backendDir, 'main.js')],
    cwd: backendDir,
  };
}

/**
 * 启动后端服务
 */
function startBackend() {
  const { cmd, args, cwd } = getBackendPath();

  console.log(`[Electron] 启动后端: ${cmd} ${args.join(' ')}`);
  console.log(`[Electron] 工作目录: ${cwd}`);

  backendProcess = spawn(cmd, args, {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'production' },
  });

  backendProcess.stdout?.on('data', (data) => {
    console.log(`[Backend] ${data.toString().trim()}`);
  });

  backendProcess.stderr?.on('data', (data) => {
    console.error(`[Backend Error] ${data.toString().trim()}`);
  });

  backendProcess.on('error', (err) => {
    console.error('[Backend] 启动失败:', err.message);
    dialog.showErrorBox('后端启动失败', `无法启动后端服务：${err.message}`);
  });

  backendProcess.on('exit', (code) => {
    console.log(`[Backend] 进程退出，代码: ${code}`);
    if (code !== 0 && mainWindow) {
      dialog.showErrorBox('后端异常退出', `后端服务已停止（退出码: ${code}）`);
    }
  });
}

/**
 * 创建启动器窗口
 * 生产环境：Electron 仅作为服务启动器，前端由后端直接托管，
 * 用户在浏览器访问 http://127.0.0.1:8000。
 */
function createWindow() {
  const isDev = process.env.NODE_ENV === 'development';

  if (isDev) {
    // 开发环境：打开系统浏览器访问 Vite 开发服务器
    shell.openExternal('http://localhost:5173');
    return;
  }

  mainWindow = new BrowserWindow({
    width: 520,
    height: 420,
    resizable: false,
    maximizable: false,
    title: 'AI 生成面板 - 服务启动器',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // 加载启动器页面（只显示访问地址和打开浏览器按钮）
  mainWindow.loadFile(path.join(__dirname, 'launcher.html'));

  // 拦截 <a target="_blank">，用系统浏览器打开，而不是在 Electron 里开新窗口
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * 优雅关闭：先关后端，再关 Electron
 */
function gracefulShutdown() {
  if (backendProcess) {
    console.log('[Electron] 正在关闭后端服务...');
    backendProcess.kill('SIGTERM');
    backendProcess = null;
  }
}

// ============ Electron 生命周期 ============

app.whenReady().then(() => {
  // 先启动后端，等几秒后再打开窗口
  startBackend();

  // 等待后端启动
  setTimeout(() => {
    createWindow();
  }, 2000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  gracefulShutdown();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  gracefulShutdown();
});

// 处理未捕获的异常
process.on('uncaughtException', (err) => {
  console.error('未捕获的异常:', err);
  gracefulShutdown();
});
