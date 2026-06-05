import { Routes } from '@angular/router';
import { TestListComponent } from './test-list/test-list.component';
import { TestEditComponent } from './test-edit/test-edit.component';
import { TestPlayerComponent } from './test-player/test-player.component';
import { TestAnalyticsComponent } from './test-analytics/test-analytics.component';
import { roleGuard } from '../../core/guards/auth.guard';

export const TESTING_ROUTES: Routes = [
  { path: '',                    component: TestListComponent },
  { path: ':moduleId/edit',      component: TestEditComponent,      canActivate: [roleGuard(['admin', 'instructor'])] },
  { path: ':moduleId/analytics', component: TestAnalyticsComponent, canActivate: [roleGuard(['admin', 'instructor'])] },
  { path: ':moduleId',           component: TestPlayerComponent },
];
