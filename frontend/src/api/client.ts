import axios from 'axios';

// 携带 Cookie 凭证（HttpOnly Cookie 鉴权）
export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err?.response?.status === 401) {
      // 未登录 -> 跳登录
      if (location.pathname !== '/login') {
        location.href = '/login';
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
