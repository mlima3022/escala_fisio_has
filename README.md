# Escala Fisio HAS

Repositório completo (sem build step) para GitHub Pages com Supabase (Auth + Postgres + RLS):

- Visualização pública de calendário e tela do profissional
- Importação/sobrescrita de escala PDF restrita a admin
- Login Google somente para liberar aba de importação

## Estrutura

```text
/
  frontend/
    index.html
    styles.css
    app.js
    supabaseClient.js
    config.example.js
  backend/
    main.py
    requirements.txt
  sql/
    schema.sql
    rls.sql
  README.md
  .gitignore
```

## Regras de acesso

- Público (sem login): `schedules`, `employees`, `assignments`, `code_legend` (somente leitura)
- Admin (Google OAuth + `profiles.is_admin = true`): importação/sobrescrita (INSERT/UPDATE/DELETE)
- Usuário autenticado sem admin: só visualização + aviso "Você não é admin"

## 1) Passo a passo no Supabase

1. Crie um projeto no Supabase.
2. No **SQL Editor**, rode [`sql/schema.sql`](/c:/Users/Matheus/Documents/escala_fisio_has/sql/schema.sql).
3. No **SQL Editor**, rode [`sql/rls.sql`](/c:/Users/Matheus/Documents/escala_fisio_has/sql/rls.sql).
4. Verifique as tabelas em **Table Editor**:
   - `profiles`, `schedules`, `employees`, `assignments`, `code_legend`
5. Em **Authentication -> URL Configuration**, configure as Redirect URLs.
6. Em **Authentication -> Providers -> Google**, habilite o provider e preencha Client ID/Secret (ver seção Google Cloud).
7. Faça o primeiro login com seu Google para criar o `profiles` via trigger.
8. Rode no SQL Editor para tornar admin:

```sql
update public.profiles
set is_admin = true
where email = 'SEUEMAIL@gmail.com';
```

9. Teste a importação:
   - Login com Google
   - Aba `Importar`
   - Upload PDF -> Preview -> Salvar

## 2) Passo a passo no Google Cloud (OAuth)

1. Acesse **Google Cloud Console** e crie um projeto.
2. Vá em **APIs & Services -> OAuth consent screen**.
   - User Type: `External` (ou `Internal` se Workspace)
   - Preencha app name, support email, developer contact.
   - Scopes básicos: `openid`, `email`, `profile`.
3. Vá em **Credentials -> Create Credentials -> OAuth client ID**.
4. Tipo: `Web application`.
5. Configure **Authorized JavaScript origins**.
6. Configure **Authorized redirect URIs**.
7. Copie `Client ID` e `Client Secret` para Supabase em **Auth -> Providers -> Google**.
8. Teste login pelo botão `Entrar com Google (Admin)`.

## URLs que você precisa cadastrar (explícitas)

Substitua:
- `<PROJECT_REF>` pelo `project-ref` do Supabase
- `<USER>` pelo usuário do GitHub
- `<REPO>` pelo nome do repositório

### A) Supabase Auth Redirect URLs

Cadastre no Supabase (Authentication -> URL Configuration):

- `http://localhost:5500/frontend/`
- `http://127.0.0.1:5500/frontend/`
- `https://<USER>.github.io/<REPO>/frontend/`

Se você hospedar a raiz em vez de `/frontend`, cadastre também:

- `https://<USER>.github.io/<REPO>/`

### B) Google Cloud Authorized redirect URIs

Cadastre no Google OAuth Client:

- `https://<PROJECT_REF>.supabase.co/auth/v1/callback`

### C) Google Cloud Authorized JavaScript origins

Cadastre no Google OAuth Client:

- `https://<PROJECT_REF>.supabase.co`
- `https://<USER>.github.io`
- `http://localhost:5500`
- `http://127.0.0.1:5500`

## Configuração do frontend

1. Copie `frontend/config.example.js` para `frontend/config.js`.
2. Preencha:

```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://SEU-PROJETO.supabase.co",
  SUPABASE_ANON_KEY: "SUA_ANON_KEY",
  PARSER_API_URL: "http://localhost:8000/parse"
};
```

## Execução local (sem build)

### Frontend

No diretório do projeto, rode um servidor estático (exemplo Python):

```bash
python -m http.server 5500
```

Abra:
- `http://localhost:5500/frontend/`

### Backend (parser PDF)

```bash
cd backend
python -m venv .venv
# Windows:
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Healthcheck:
- `http://localhost:8000/health`

## Deploy no GitHub Pages

- Faça push do repositório.
- Em **Settings -> Pages**, selecione branch e pasta.
- Recomendação para este layout: publicar a raiz e acessar `.../frontend/`.

## Observações técnicas

- O parser em [`backend/main.py`](/c:/Users/Matheus/Documents/escala_fisio_has/backend/main.py) já retorna no formato JSON obrigatório.
- A heurística de parsing textual deve ser ajustada ao layout real do PDF institucional (linhas/colunas).
- O fluxo de sobrescrita:
  - Se `schedule(month, year)` existe: modal `Sobrescrever / Cancelar`
  - Sobrescrever: apaga `assignments` do mês e reinsere
  - `employees`: upsert por `matricula`

## Segurança

- Não versione `frontend/config.js` com chaves reais.
- Use sempre `anon key` no frontend.
- Escrita é bloqueada por RLS para não-admin.
