import { Routes } from '@angular/router';
import { SimConstructorComponent } from './constructor/sim-constructor.component';
import { SimPlayerComponent } from './player/sim-player.component';

export const SIMULATOR_ROUTES: Routes = [
  { path: '',         component: SimConstructorComponent },
  { path: 'new',      component: SimConstructorComponent },
  { path: ':id/edit', component: SimConstructorComponent },
  { path: ':id/play', component: SimPlayerComponent },
];
