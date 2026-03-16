import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { ApiService } from '../../core/services/api.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit {
  user: any;
  stats = { users: 0, courses: 0, simulations: 0 };
  recentActivity: any[] = [];
  loading = true;

  constructor(private auth: AuthService, private api: ApiService) {
    this.user = this.auth.currentUser;
  }

  ngOnInit(): void {
    this.loadStats();
  }

  loadStats(): void {
    this.api.get<any[]>('courses/').subscribe({
      next: data => {
        this.stats.courses = Array.isArray(data) ? data.length : (data as any).count ?? 0;
        this.loading = false;
      },
      error: () => { this.loading = false; }
    });
  }

  logout(): void {
    this.auth.logout();
  }
}
