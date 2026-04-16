# Chamada QR Code

Sistema web de registro de presença escolar via leitura de QR Code. Cada aluno possui um QR Code vinculado à sua matrícula; o professor escaneia e a presença é registrada em tempo real.

## Funcionalidades

- Registro de presença por leitura de QR Code (câmera)
- Suporte a `BarcodeDetector` nativo e `jsQR` como fallback
- Cadastro de alunos com foto, matrícula, turma, instituição e dados pessoais
- Geração de QR Codes para impressão ou teste
- Contadores em tempo real (total, presentes, ausentes)

## Tecnologias

- **Frontend:** HTML, CSS, JavaScript (ES Modules)
- **Bundler:** Vite
- **Backend/Banco:** Supabase (PostgreSQL + Storage)

## Estrutura

```
├── index.html           # Tela de chamada
├── cadastro.html        # Cadastro de alunos
├── qr-teste.html        # Geração de QR Codes para teste
├── src/
│   ├── app.js           # Lógica da chamada
│   ├── cadastro.js      # Lógica do cadastro
│   ├── qr-teste.js      # Geração dos QR Codes
│   ├── supabase.js      # Cliente Supabase
│   └── style.css        # Estilos globais
├── migrations/          # Scripts SQL incrementais do banco
├── .env.example         # Variáveis de ambiente necessárias
└── vite.config.js
```

## Configuração

### 1. Clonar e instalar

```bash
git clone <url-do-repositorio>
cd qrcode-chamada
npm install
```

### 2. Variáveis de ambiente

```bash
cp .env.example .env
```

Preencha o `.env` com as credenciais do seu projeto Supabase:

```env
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON=sua-anon-key
```

### 3. Banco de dados

Execute os arquivos da pasta `migrations/` **em ordem** no [Supabase SQL Editor](https://supabase.com/dashboard):

```
migrations/001_initial_schema.sql
migrations/002_indexes_triggers.sql
...
```

### 4. Rodar localmente

```bash
npm run dev
```

Acesse `http://localhost:5173`

### 5. Build para produção

```bash
npm run build
npm run preview
```

## Uso

| Página | URL | Descrição |
|---|---|---|
| Chamada | `/` | Escaneia QR Codes e registra presença |
| Chamada por turma | `/?turma=<uuid>` | Filtra alunos de uma turma específica |
| Cadastro | `/cadastro.html` | Cadastra novos alunos |
| QR Codes | `/qr-teste.html` | Gera QR Codes para impressão |
| QR por turma | `/qr-teste.html?turma=<uuid>` | QR Codes de uma turma específica |
