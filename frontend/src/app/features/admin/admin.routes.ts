import { Routes } from '@angular/router';
import { AdminUsersComponent } from './users/admin-users.component';
import { AdminDiplomasComponent } from './diplomas/admin-diplomas.component';

export const ADMIN_ROUTES: Routes = [
  { path: '',         component: AdminUsersComponent },
  { path: 'diplomas', component: AdminDiplomasComponent },
];
