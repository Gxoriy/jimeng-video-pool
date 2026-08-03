import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { mergeMap } from 'rxjs/operators';

const isPromise = (v: any): v is Promise<any> =>
  !!v && (typeof v === 'object' || typeof v === 'function') && typeof v.then === 'function';

/**
 * 统一响应兜底拦截器。
 *
 * 背景：控制器统一返回 `{ code, message, data }`。Nest 只会 await **顶层** 返回值，
 * 不会 await 嵌套在 data 字段里的 Promise —— 一旦某个路由写成
 * `return { code: 0, message: 'ok', data: this.svc.foo() }`（漏了 await），
 * JSON 序列化后 data 会变成空对象 `{}`，前端拿不到任何内容且不报错，极难排查。
 * （历史事故：个人设置保存 RunningHub Key 后状态一直不刷新。）
 *
 * 这里在全局兜底：检测到 data 是 Promise 就自动 await，避免同类问题复发。
 */
@Injectable()
export class ResponseNormalizeInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      mergeMap(async (body: any) => {
        if (body && typeof body === 'object' && isPromise(body.data)) {
          return { ...body, data: await body.data };
        }
        return body;
      }),
    );
  }
}
