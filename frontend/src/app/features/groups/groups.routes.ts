import { Routes } from '@angular/router';
import { GroupListComponent } from './group-list/group-list.component';
import { GroupEditComponent } from './group-edit/group-edit.component';

export const GROUPS_ROUTES: Routes = [
  { path: '',    component: GroupListComponent },
  { path: ':id', component: GroupEditComponent },
];
