const { app, BrowserWindow, dialog, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let mainWindow;
let backendProcess;
let backendRestartCount = 0;
const MAX_BACKEND_RESTART = 3;
const BACKEND_MAX_STARTUP_MS = 30000;
const BACKEND_POLL_INTERVAL_MS = 500;
const BACKEND_HEALTH_PATH = '/health';

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
 * 后端健康检查：探测后端是否已就绪（端口可连接 + 可选 /health 端点）
 */
function waitForBackend(port, onReady) {
  const start = Date.now();
  const tryOnce = () => {
    const http = require('http');
    const req = http.get(
      { host: '127.0.0.1', port, path: BACKEND_HEALTH_PATH, timeout: 1500 },
      (res) => {
        res.resume();
        if (res.statusCode < 500) {
          onReady(true);
        } else {
          retry();
        }
      }
    );
    req.on('error', retry);
    req.on('timeout', () => {
      req.destroy();
      retry();
    });

    function retry() {
      if (Date.now() - start > BACKEND_MAX_STARTUP_MS) {
        onReady(false);
        return;
      }
      setTimeout(tryOnce, BACKEND_POLL_INTERVAL_MS);
    }
  };
  tryOnce();
}

/**
 * 启动后端服务（带崩溃自愈：异常退出时自动重启，最多 MAX_BACKEND_RESTART 次）
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
    // 非主动退出且还有重启额度 → 自动自愈重启
    if (code !== 0 && !app.isQuiting) {
      if (backendRestartCount < MAX_BACKEND_RESTART) {
        backendRestartCount += 1;
        console.log(`[Backend] 检测到异常退出，准备第 ${backendRestartCount} 次自愈重启...`);
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('backend-status', { restarting: true });
          }
          startBackend();
        }, 1000);
        return;
      }
      if (mainWindow) {
        dialog.showErrorBox('后端异常退出', `后端服务多次重启失败（退出码: ${code}），请检查日志。`);
      }
    }
  });
}

/**
 * 创建启动器窗口
 * 生产环境：Electron 仅作为服务启动器，前端由后端直接托管，
 * 用户在浏览器访问 http://127.0.0.1:8000。
 */
/**
 * 读取后端 .env 的 PORT（默认 8000），传给启动器窗口用于拼接访问地址与轮询健康检查。
 */
function getPort() {
  try {
    const isDev = process.env.NODE_ENV === 'development';
    const baseDir = isDev
      ? path.join(__dirname, '../../backend')
      : path.join(process.resourcesPath, 'backend');
    const txt = fs.readFileSync(path.join(baseDir, '.env'), 'utf8');
    const m = txt.match(/^\s*PORT\s*=\s*(\d+)/m);
    if (m) return m[1];
  } catch {
    /* 忽略，回退 8000 */
  }
  return '8000';
}

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

  // 加载启动器页面（只显示访问地址和打开浏览器按钮），并注入实际端口
  const port = getPort();
  mainWindow.loadFile(path.join(__dirname, 'launcher.html'), { search: `port=${port}` });

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
    try {
      backendProcess.kill('SIGTERM');
    } catch {
      /* 忽略，进程可能已退出 */
    }
    backendProcess = null;
  }
}

// ============ Electron 生命周期 ============

app.whenReady().then(() => {
  // 先启动后端，再用健康检查轮询等待其就绪，就绪后再创建窗口
  startBackend();

  const port = getPort();
  waitForBackend(port, (ready) => {
    if (ready) {
      console.log('[Electron] 后端已就绪，打开启动器窗口');
      createWindow();
    } else {
      console.error('[Electron] 后端在限定时间内未就绪，仍尝试打开窗口并提示用户');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('backend-status', { timeout: true });
      } else {
        createWindow();
      }
    }
  });

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
  app.isQuiting = true;
  gracefulShutdown();
});

// 处理未捕获的异常
process.on('uncaughtException', (err) => {
  console.error('未捕获的异常:', err);
  gracefulShutdown();
});
