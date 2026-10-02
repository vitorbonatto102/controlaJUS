# ControlaJUS

Plataforma interna do escritório em Next.js App Router, TypeScript, Supabase Auth, PostgreSQL e Storage. A interface usa português do Brasil, `R$ 1.234,56` e `DD/MM/AAAA`. Os dados são vinculados ao UUID da advogada, sem páginas ou regras específicas para uma pessoa.

## Estrutura

```text
src/app/
  login/                     autenticação
  auth/confirm/              aceitação de convite
  definir-senha/             senha criada pela pessoa convidada
  advogada/                 contratos, indicadores, fechamentos e inadimplência
    notificacoes/            central de avisos e leitura
    novo-contrato/           cadastro e PDF
    contratos/[id]/          detalhe e PDF temporário
  secretaria/                operação, clientes, pagamentos e cobranças
  gestor/                    painel, fechamento, repasses e correções
  administracao/             convites e gestão de usuários
  admin/users/               entrada alternativa para administração
src/components/              interface reutilizável
src/lib/
  auth/                      perfil e controle de função
  contracts/                 CPF, cronograma, centavos e indicadores
  secretary/                 consultas e status operacionais
  manager/                   consolidação e filtros do gestor
  finance/                   fechamentos, itens, repasses, ajustes e auditoria
  supabase/                  clientes SSR e renovação de sessão
supabase/migrations/          migrations SQL em ordem cronológica
supabase/templates/           e-mails de convite e recuperação
tests/                       regras e integração SQL via PGlite
```

## Instalação e Supabase

1. Instale Node.js 22 e rode `npm ci`.
2. Crie o projeto Supabase. Copie `.env.example` para `.env.local` e preencha as três variáveis. `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` podem chegar ao navegador; `SUPABASE_SECRET_KEY` é a **secret key de servidor** do mesmo projeto e nunca deve ter prefixo `NEXT_PUBLIC_`.
3. Aplique as migrations na ordem dos nomes, com `supabase db push` após vincular o projeto pela CLI ou executando cada arquivo em **Supabase → SQL Editor**. As migrations anteriores não foram reescritas. Para atualizar um projeto que já estava na etapa 3, aplique apenas `20261002000100_closings_management.sql` e depois `20261002000200_payment_integrity.sql`. O build do Next.js não aplica SQL automaticamente.
4. Em **Authentication → Providers → Email**, mantenha Email habilitado e desative cadastro público (**Allow new users to sign up**). Desative login anônimo. `supabase/config.toml` faz isso no ambiente local da CLI; no projeto hospedado, configure pelo Dashboard.
5. Em **Authentication → URL Configuration**, informe a Site URL correta (por exemplo, `http://localhost:3001` durante desenvolvimento e a URL da Vercel em produção). Em **Email Templates**, copie [invite.html](supabase/templates/invite.html) para **Invite user** e [recovery.html](supabase/templates/recovery.html) para **Reset password**. Os links abrem páginas com botão de confirmação, evitando consumo automático do token por verificadores de e-mail. Configure SMTP adequado para uso real.
6. Confira o bucket privado `contract-pdfs` criado pelas migrations. Ele aceita somente PDF de até 10 MiB. Não o torne público.
7. Rode `npm run dev` e acesse `/login`. No Windows, se Node emitir `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, use `npm run dev:system-ca` para confiar nos certificados do Windows.

### Primeiro administrador

Sem um admin ativo, convide **uma** conta inicial em **Authentication → Users → Add user → Send invitation**. O trigger cria seu `profiles` inativo. Execute uma única vez no SQL Editor, substituindo o e-mail:

```sql
update public.profiles
set full_name = 'Nome do Administrador', role = 'admin', active = true
where id = (select id from auth.users where email = 'admin@exemplo.com');
```

Confirme que exatamente uma linha mudou. Essa etapa inicial usa o SQL Editor como operador privilegiado. Depois, entre com essa conta em `/administracao`, convide as demais pessoas e escolha `lawyer`, `secretary`, `manager` ou `admin`. A pessoa aceita o link e define a própria senha. O admin não escolhe nem vê a senha. Se o convite expirou ou já foi usado, envie outro convite pelo Supabase Auth; para conta já ativada, use **Esqueci minha senha**. Cada conta possui um único perfil; quem precisa de duas áreas deve usar contas separadas.

## Regras financeiras

- `installments.contractual_amount` é o valor previsto. `payments.amount_paid` é o valor efetivamente recebido, inclusive pagamentos parciais e juros. Uma parcela pode ter vários pagamentos.
- O gatilho de pagamento cria `commissions` com percentual do contrato e valor recebido. O percentual não vem do perfil atual da advogada.
- O fechamento usa `payments.payment_date` no mês-calendário. Só pode ser confirmado no último dia desse mês ou depois. A prévia mostra todos os pagamentos válidos antes da confirmação.
- `monthly_closing_items` conserva cliente, origem, data, pagamento, percentual e comissão originais. Uma correção posterior mantém esses itens e cria `closing_adjustments`. O saldo atual do fechamento considera os ajustes.
- Um fechamento aceita vários `commission_transfers`. A soma ativa é o valor repassado; repasse maior que o saldo é rejeitado. Uma reversão exige motivo e preserva o registro original.
- A secretaria não consegue inserir um pagamento com data de mês já fechado. O gestor usa **Lançamento complementar**, que insere o pagamento e o ajuste na mesma transação, com auditoria e notificação.
- A advogada vê em **A receber** o saldo acumulado de todas as comissões efetivas ativas menos todos os repasses ativos, inclusive comissões de mês ainda não fechado. A estimativa contratual e a participação potencial de parcelas vencidas ficam identificadas separadamente.
- O prazo de 30 dias após o fechamento é um indicador gerencial; nunca bloqueia o repasse.

## Áreas e segurança

| Perfil | Acesso |
| --- | --- |
| `lawyer` | Somente contratos, clientes associados, parcelas, pagamentos, comissões, fechamentos, repasses e notificações da própria conta. Pode cadastrar contrato com PDF, mas não registrar recebimentos ou repasses. |
| `secretary` | Dados operacionais de clientes, contratos, parcelas, pagamentos e notas. Não lê percentual, comissão, fechamento, repasse ou auditoria. Registra pagamentos e corrige somente lançamentos próprios de meses abertos. |
| `manager` | Vê todas as advogadas e dados financeiros. Confirma fechamentos, registra/reverte repasses e corrige informações por RPC com motivo. Não possui permissões administrativas de usuário. |
| `admin` | Convites e alterações de nome, perfil e ativação de usuários. Não herda a interface de gestor; funções de gestão exigem `manager`. |

As tabelas expostas possuem RLS e grants explícitos. A maioria das mutações financeiras não tem permissão direta de `UPDATE`/`DELETE`; funções `SECURITY DEFINER` no schema privado validam `auth.uid()` e `private.current_role()`, usam `search_path` fixo e executam lançamento, log, ajuste e notificação em transação. `audit_logs` rejeita alterações e exclusões até por gatilho. Alterações de perfil só passam por `admin_update_profile`; o último admin ativo e uma advogada com histórico financeiro não podem perder esse perfil por engano. Usuários inativos não passam pelas políticas nem pelas páginas protegidas.

O gestor corrige pagamento por estorno lógico e substituição; o original e sua comissão permanecem acessíveis para auditoria. Corrigir percentual atualiza as comissões válidas, registra cada diferença e adiciona ajustes aos meses fechados, preservando os itens originais do fechamento. Corrigir valor total do contrato **não** modifica as parcelas automaticamente; o gestor deve conferir e corrigir o cronograma, cada mudança com motivo.

## Banco

Migrations novas desta etapa:

| Arquivo | Conteúdo |
| --- | --- |
| `20261002000100_closings_management.sql` | Itens de fechamento, ajustes, repasses, índices, RLS e funções de fechamento, transferência, correção e gestão de perfis. |
| `20261002000200_payment_integrity.sql` | Bloqueio de pagamentos retroativos em meses fechados, lançamento complementar do gestor e auditoria de criações. |

Tabelas existentes: `profiles`, `clients`, `contracts`, `contract_financial_terms`, `installments`, `payments`, `commissions`, `collection_notes`, `monthly_closings`, `audit_logs`, `notifications`. Novas tabelas: `monthly_closing_items`, `closing_adjustments`, `commission_transfers`. Índices cobrem advogada, período, data de pagamento, vencimento, repasses, notificações e busca de auditoria por registro.

## Rodar e verificar

```powershell
npm run lint
npm run typecheck
npm run build
npm test
```

Os testes SQL aplicam **todas** as migrations em PostgreSQL isolado com PGlite e verificam RLS, separação de valores, pagamentos parciais/múltiplos, mudança de mês, snapshot de fechamento, repasses parciais/múltiplos, reversão, correção posterior, ajustes, auditoria, notificações e alterações administrativas. O fluxo de e-mail e Storage no projeto hospedado exige uma verificação manual com contas fictícias, pois depende de Supabase Auth, SMTP e Storage externos.

## Vercel

Importe o repositório como projeto Next.js. Configure as três variáveis de `.env.example` em **Project Settings → Environment Variables** nos ambientes necessários. `SUPABASE_SECRET_KEY` deve ficar apenas no ambiente de servidor. Execute as migrations no Supabase **antes** de publicar a versão. Configure a Site URL e templates para o domínio final. O comando de build é `npm run build`; não há dependência de servidor próprio ou cron nesta etapa.
