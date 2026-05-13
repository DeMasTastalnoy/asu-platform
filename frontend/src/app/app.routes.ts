import { Routes } from '@angular/router';
import { authGuard, roleGuard } from './core/guards/auth.guard';
import { LayoutComponent } from './shared/components/layout/layout.component';

export const routes: Routes = [
  {
    path: 'auth',
    loadChildren: () =>
      import('./features/auth/auth.routes').then(m => m.AUTH_ROUTES),
  },
  {
    path: '',
    component: LayoutComponent,
    canActivate: [authGuard],
    children: [
      {
        path: 'dashboard',
        loadChildren: () =>
          import('./features/dashboard/dashboard.routes').then(m => m.DASHBOARD_ROUTES),
      },
      {
        path: 'courses',
        loadChildren: () =>
          import('./features/courses/courses.routes').then(m => m.COURSES_ROUTES),
      },
      {
        path: 'simulator',
        canActivate: [authGuard],
        loadChildren: () =>
          import('./features/simulator/simulator.routes').then(m => m.SIMULATOR_ROUTES),
      },
      {
        path: 'testing',
        loadChildren: () =>
          import('./features/testing/testing.routes').then(m => m.TESTING_ROUTES),
      },
      {
        path: 'analytics',
        canActivate: [roleGuard(['admin', 'instructor'])],
        loadChildren: () =>
          import('./features/analytics/analytics.routes').then(m => m.ANALYTICS_ROUTES),
      },
      {
        path: 'admin',
        canActivate: [roleGuard(['admin'])],
        loadChildren: () =>
          import('./features/admin/admin.routes').then(m => m.ADMIN_ROUTES),
      },
      {
  path: 'profile',
  loadChildren: () =>
    import('./features/profile/profile.routes').then(m => m.PROFILE_ROUTES),
},
    ],
  },
  { path: '',  redirectTo: 'dashboard', pathMatch: 'full' },
  { path: '**', redirectTo: 'dashboard' },
];
