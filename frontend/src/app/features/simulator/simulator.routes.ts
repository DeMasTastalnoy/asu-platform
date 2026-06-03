import { Routes } from '@angular/router';
import { SimListComponent } from './list/sim-list.component';
import { SimConstructorComponent } from './constructor/sim-constructor.component';
import { SimPlayerComponent } from './player/sim-player.component';
import { roleGuard } from '../../core/guards/auth.guard';

export const SIMULATOR_ROUTES: Routes = [
  { path: '',         component: SimListComponent,        canActivate: [roleGuard(['admin', 'instructor'])] },
  { path: 'new',      component: SimConstructorComponent, canActivate: [roleGuard(['admin', 'instructor'])] },
  { path: ':id/edit', component: SimConstructorComponent, canActivate: [roleGuard(['admin', 'instructor'])] },
  { path: ':id/play', component: SimPlayerComponent },
];
