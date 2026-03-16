import { HttpInterceptorFn, HttpRequest, HttpHandlerFn, HttpErrorResponse, HttpClient } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

export const jwtInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
) => {
  const auth  = inject(AuthService);
  const http  = inject(HttpClient);
  const token = auth.getAccessToken();

  const authReq = token
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401 && auth.getRefreshToken()) {
        return http.post<{ access: string }>('http://127.0.0.1:8000/api/auth/refresh/', {
          refresh: auth.getRefreshToken(),
        }).pipe(
          switchMap(tokens => {
            localStorage.setItem('access_token', tokens.access);
            const retryReq = req.clone({
              setHeaders: { Authorization: `Bearer ${tokens.access}` },
            });
            return next(retryReq);
          }),
          catchError(() => {
            auth.logout();
            return throwError(() => error);
          }),
        );
      }
      return throwError(() => error);
    }),
  );
};
