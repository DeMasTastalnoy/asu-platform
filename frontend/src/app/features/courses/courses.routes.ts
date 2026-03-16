import { Routes } from '@angular/router';
import { CoursesListComponent } from './courses-list/courses-list.component';
import { CourseCreateComponent } from './course-create/course-create.component';
import { CourseDetailComponent } from './course-detail/course-detail.component';
import { ModuleCreateComponent } from './module-create/module-create.component';

export const COURSES_ROUTES: Routes = [
  { path: '',                          component: CoursesListComponent  },
  { path: 'create',                    component: CourseCreateComponent },
  { path: ':id',                       component: CourseDetailComponent },
  { path: ':id/modules/create',        component: ModuleCreateComponent },
];
