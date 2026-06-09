# Развёртывание АСУ-Платформы (Ubuntu VPS)

Схема: **nginx** отдаёт собранный Angular и проксирует `/api`, `/media`, `/static`
на **gunicorn** (Django). БД — **MySQL**. Один домен/IP.

> Все пути в примерах — `/var/www/asu-platform`. Замените на свой при необходимости.

---

## 0. Что нужно
- VPS с **Ubuntu 22.04**, доступ по SSH (`ssh root@IP`), 1 vCPU / 1 ГБ RAM достаточно.
- (опц.) домен, направленный A-записью на IP сервера — для HTTPS.

## 1. Системные пакеты
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y python3-venv python3-pip git nginx mysql-server curl
# Node.js 20 (для сборки фронта)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

## 2. MySQL: база и пользователь
```bash
sudo mysql
```
```sql
CREATE DATABASE asu_platform CHARACTER SET utf8mb4;
CREATE USER 'asu'@'localhost' IDENTIFIED BY 'СИЛЬНЫЙ_ПАРОЛЬ';
GRANT ALL PRIVILEGES ON asu_platform.* TO 'asu'@'localhost';
FLUSH PRIVILEGES; EXIT;
```

## 3. Код
```bash
sudo mkdir -p /var/www && cd /var/www
sudo git clone https://github.com/DeMasTastalnoy/asu-platform.git
sudo chown -R $USER:$USER /var/www/asu-platform
cd /var/www/asu-platform
```

## 4. Бэкенд: окружение и зависимости
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
pip install gunicorn   # уже в requirements, но на всякий
```
Создать `backend/.env` (по образцу `backend/.env.example`):
```ini
DJANGO_SECRET_KEY=<python3 -c "import secrets; print(secrets.token_urlsafe(64))">
DEBUG=False
ALLOWED_HOSTS=ВАШ_ДОМЕН_ИЛИ_IP
DB_NAME=asu_platform
DB_USER=asu
DB_PASSWORD=СИЛЬНЫЙ_ПАРОЛЬ
DB_HOST=127.0.0.1
DB_PORT=3306
CORS_ORIGINS=http://ВАШ_ДОМЕН_ИЛИ_IP
UPLOAD_MAX_MB=2000
SECURE=False          # включить True ПОСЛЕ выпуска HTTPS-сертификата
```

## 5. Данные БД
Тренажёр ДКВР и часть наполнения — это **данные в БД** (в git их нет).
Поэтому переносим базу с рабочей машины.

**Вариант A (рекомендуется) — перенести всю БД дампом.**
На локальной машине (Windows, PowerShell):
```powershell
& "C:\путь\к\mysqldump.exe" -u root -p --port=3320 asu_platform > asu_dump.sql
```
Залить файл на сервер (FileZilla / scp), затем на сервере:
```bash
mysql -u asu -p asu_platform < asu_dump.sql
cd backend && ../.venv/bin/python manage.py migrate   # доводит схему, если нужно
```

**Вариант B — чистая БД с нуля (без переноса):**
```bash
cd backend
../.venv/bin/python manage.py migrate
../.venv/bin/python manage.py seed_boiler_library
../.venv/bin/python manage.py seed_demo_content       # ⚠ требует шаблон ДКВР (id=3) в БД
../.venv/bin/python manage.py seed_panel_simulation
../.venv/bin/python manage.py seed_demo_people
```
> ⚠ `seed_demo_content` сохраняет существующий ДКВР, но **не создаёт** его. На полностью
> чистой БД ДКВР придётся собрать в конструкторе или перенести вариантом A. Пульт,
> курсы, тесты и люди создаются командами выше.

Создать администратора и собрать статику:
```bash
../.venv/bin/python manage.py createsuperuser
../.venv/bin/python manage.py collectstatic --noinput
```

## 6. Фронтенд: сборка
```bash
cd /var/www/asu-platform/frontend
npm install
npx ng build --configuration production
# результат: frontend/dist/frontend/browser
```

## 7. gunicorn (systemd)
```bash
sudo cp deploy/asu-platform.service /etc/systemd/system/asu-platform.service
sudo nano /etc/systemd/system/asu-platform.service   # проверить пути и User
sudo systemctl daemon-reload
sudo systemctl enable --now asu-platform
sudo systemctl status asu-platform        # должно быть active (running)
```

## 8. nginx
```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/asu-platform
sudo nano /etc/nginx/sites-available/asu-platform   # server_name + пути
sudo ln -s /etc/nginx/sites-available/asu-platform /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

## 9. Файрвол
```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

Откройте `http://ВАШ_ДОМЕН_ИЛИ_IP` — приложение должно работать.

## 10. HTTPS (если есть домен)
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d ВАШ_ДОМЕН
```
После выпуска сертификата:
- в `backend/.env` поставить `SECURE=True`, `CORS_ORIGINS=https://ВАШ_ДОМЕН`, `ALLOWED_HOSTS=ВАШ_ДОМЕН`;
- `sudo systemctl restart asu-platform`.

---

## Обновление после изменений в git
```bash
cd /var/www/asu-platform && git pull
source .venv/bin/activate
pip install -r backend/requirements.txt
cd backend && python manage.py migrate && python manage.py collectstatic --noinput
cd ../frontend && npm install && npx ng build --configuration production
sudo systemctl restart asu-platform && sudo systemctl reload nginx
```

## Аккаунты демо-данных (если переносили БД / запускали seed_demo_people)
Пароль всех демо-аккаунтов: `Demo!2026`
- Преподаватели: `ivanov`, `petrov`
- Студенты: `student01` … `student20`
