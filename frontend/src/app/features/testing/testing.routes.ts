import { Routes } from '@angular/router';
import { TestPlayerComponent } from './test-player/test-player.component';

export const TESTING_ROUTES: Routes = [
  { path: ':moduleId', component: TestPlayerComponent },
];
