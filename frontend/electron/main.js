const { app, BrowserWindow, dialog } = require('electron');
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

  // Windows 使用打包后的 exe，其他平台用 node + js
  if (process.platform === 'win32') {
    const exePath = path.join(backendDir, 'main.exe');
    if (fs.existsSync(exePath)) {
      return { cmd: exePath, args: [], cwd: backendDir };
    }
  }

  // 回退：用 node 运行 js
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
 * 创建主窗口
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    title: 'AI 生成面板',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const isDev = process.env.NODE_ENV === 'development';

  if (isDev) {
    // 开发环境：加载 Vite 开发服务器
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // 生产环境：加载打包后的静态文件
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

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
