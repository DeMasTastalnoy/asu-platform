import { Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';
import { ApiService } from './api.service';
import { User, AuthTokens, LoginRequest, RegisterRequest } from '../models/user.model';

@Injectable({ providedIn: 'root' })
export class AuthService {
  currentUser = signal<User | null>(null);
  isLoggedIn  = signal<boolean>(false);

  constructor(private api: ApiService, private router: Router) {
    this.loadFromStorage();
  }

  login(credentials: LoginRequest): Observable<AuthTokens> {
    return this.api.post<AuthTokens>('auth/login/', credentials).pipe(
      tap(tokens => {
        localStorage.setItem('access_token',  tokens.access);
        localStorage.setItem('refresh_token', tokens.refresh);
        this.isLoggedIn.set(true);
        this.loadCurrentUser();
      })
    );
  }

  register(data: RegisterRequest): Observable<User> {
    return this.api.post<User>('auth/register/', data);
  }

  logout(): void {
    const refresh = localStorage.getItem('refresh_token');
    if (refresh) {
      this.api.post('auth/logout/', { refresh }).subscribe();
    }
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    this.currentUser.set(null);
    this.isLoggedIn.set(false);
    this.router.navigate(['/auth/login']);
  }

  loadCurrentUser(): void {
    this.api.get<User>('users/me/').subscribe({
      next: user => this.currentUser.set(user),
      error: ()  => this.logout(),
    });
  }

  getAccessToken(): string | null {
    return localStorage.getItem('access_token');
  }

  getRefreshToken(): string | null {
    return localStorage.getItem('refresh_token');
  }

  private loadFromStorage(): void {
    const token = localStorage.getItem('access_token');
    if (token) {
      this.isLoggedIn.set(true);
      this.loadCurrentUser();
    }
  }
}
