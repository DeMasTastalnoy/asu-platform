import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

export const authGuard: CanActivateFn = () => {
  const router = inject(Router);
  const token  = localStorage.getItem('access_token');

  if (token) {
    return true;
  }
  router.navigate(['/auth/login']);
  return false;
};

export const roleGuard = (allowedRoles: string[]): CanActivateFn => () => {
  const router = inject(Router);
  const token  = localStorage.getItem('access_token');

  if (!token) {
    router.navigate(['/auth/login']);
    return false;
  }

  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const role = payload.primary_role ?? payload.role ?? '';
    if (allowedRoles.includes(role)) return true;
} catch {}

  router.navigate(['/dashboard']);
  return false;
};


