import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = () => {
  const auth   = inject(AuthService);
  const router = inject(Router);

  if (auth.isLoggedIn()) {
    return true;
  }
  router.navigate(['/auth/login']);
  return false;
};

export const roleGuard = (allowedRoles: string[]): CanActivateFn => () => {
  const auth   = inject(AuthService);
  const router = inject(Router);
  const user   = auth.currentUser();

  if (user && allowedRoles.includes(user.primary_role)) {
    return true;
  }
  router.navigate(['/dashboard']);
  return false;
};
