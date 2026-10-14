# Personal trainer mode (fork)

Fork de `DuarteSantos8/openGym` que adiciona o papel **personal trainer**: um usuário que
gerencia o treino de vários alunos. Uma instância pode ter vários trainers, cada um com os
seus alunos; um aluno tem no máximo um trainer.

## Decisões

| Tema | Decisão |
|---|---|
| Vínculo | Código gerado pelo trainer. Aluno novo cria a conta com ele (vale como convite em `INVITE_ONLY`) e já nasce vinculado; aluno com conta resgata em Settings. Trainer ou aluno desfazem o vínculo |
| Quem vira trainer | O admin marca o usuário (`POST /api/admin/user/trainer`) |
| Edição pelo aluno | Configurável por aluno: `planLocked` no registro do aluno. Travado = o servidor descarta mudanças do aluno nas chaves de plano |
| Visibilidade do trainer | Plano, histórico de treinos, peso corporal, medidas, estatísticas. Nunca: fotos/vídeos, Coach, lembretes, preferências de app |

## Modelo de dados (`db.json`)

```jsonc
// users[]
{ "id": "u_…", "trainer": true }                 // papel, setado pelo admin
{ "id": "u_…", "trainerId": "u_…", "planLocked": false }   // aluno vinculado

// trainerCodes[] — separado de invites[] (convite de cadastro tem outra semântica)
{ "code": "A1B2…", "trainerId": "u_…", "created": "ISO", "usedBy": null, "usedAt": null }
```

O estado de treino continua em `state-<uid>.json` do **aluno**. O trainer não tem cópia.

## Escrita do trainer e sincronização

O trainer lê o documento do aluno (`GET /api/trainer/student?id=`) com `rev`/`wid` e grava
de volta só as chaves de plano (`PUT /api/trainer/student?id=`, com `baseRev`/`baseWid`).
O servidor:

1. recusa com 409 se o documento mudou desde a leitura (mesma regra de `PUT /api/data`);
2. monta o novo documento = documento atual do aluno + chaves de plano do trainer;
3. passa por `stampPut` como escritor que **não carimba** (`stamped: false`, `overRead: true`):
   o servidor carimba o que mudou no horário dele, então o merge do celular do aluno
   (`sync-merge.js`) enxerga a mudança do trainer como a mais recente;
4. grava com `_rev` novo; o celular do aluno vê o rev mudar no próximo poll e puxa.

Com `planLocked`, `PUT /api/data` do próprio aluno passa por `enforcePlanLock`, que repõe as
chaves de plano do documento armazenado antes do `stampPut`.

## Rotas

| Rota | Quem |
|---|---|
| `POST /api/admin/user/trainer` `{id, trainer}` | admin |
| `GET /api/trainer/students` | trainer |
| `GET /api/trainer/codes` · `POST /api/trainer/codes/new` · `POST /api/trainer/codes/revoke` | trainer |
| `GET /api/trainer/student?id=` · `PUT /api/trainer/student?id=` | trainer do aluno |
| `POST /api/trainer/student/lock` `{id, locked}` · `POST /api/trainer/student/unlink` `{id}` | trainer do aluno |
| `GET /api/student/trainer` · `POST /api/student/link` `{code}` · `POST /api/student/unlink` | aluno |

## Fases

1. **Backend** — papel, códigos, vínculo, leitura/escrita do plano, trava. Testes em `api/test/trainer-*.test.js`.
2. **Frontend** — tela "Alunos" para o trainer; editar plano do aluno reusando `Plan`/`RoutineEdit`
   num contexto de "documento alheio"; leitura de histórico/stats; Settings do aluno com código e trava.
3. **Polimento** — notificação push ao aluno quando o plano muda; auditoria em `audit.log`.

## Manter o fork atualizado

```bash
git fetch upstream
git rebase upstream/main     # ou merge, na branch main do fork
```

Diff com upstream é mantido pequeno de propósito: lógica em `api/trainer/`, server.js só ganha o
spread das rotas, o hook da trava em `PUT /api/data` e os campos novos em `/api/me`.
