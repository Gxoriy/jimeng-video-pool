import axios from 'axios';

// 携带 Cookie 凭证（HttpOnly Cookie 鉴权）
export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

// 刷新 token 相关状态
let isRefreshing = false;
let failedQueue: Array<{ resolve: (value?: any) => void; reject: (reason?: any) => void }> = [];

const processQueue = (error: any) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve();
    }
  });
  failedQueue = [];
};

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const originalRequest = err.config;

    if (err?.response?.status === 401 && !originalRequest._retry) {
      // 如果是刷新接口本身返回 401，直接跳转登录
      if (originalRequest.url === '/auth/refresh') {
        if (location.pathname !== '/login') {
          location.href = '/login';
        }
        return Promise.reject(err);
      }

      if (isRefreshing) {
        // 正在刷新中，将请求加入队列等待
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then(() => {
          return api(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        // 尝试刷新 token
        await axios.post('/api/auth/refresh', {}, { withCredentials: true });
        processQueue(null);
        // 重试原请求
        return api(originalRequest);
      } catch (refreshErr) {
        processQueue(refreshErr);
        // 刷新失败，跳转登录
        if (location.pathname !== '/login') {
          location.href = '/login';
        }
        return Promise.reject(refreshErr);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(err);
  },
);

export interface User {
  id: string;
  username: string;
  role: 'super_admin' | 'normal_user';
  networkScope: 'restricted' | 'broad';
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}
