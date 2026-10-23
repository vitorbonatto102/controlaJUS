# Repassum

Plataforma interna em Next.js App Router, TypeScript, Supabase Auth, PostgreSQL e Storage. A interface usa português do Brasil, `R$ 1.234,56` e `DD/MM/AAAA`. Os dados ficam isolados por escritório e, no perfil `lawyer`, vinculados ao UUID da própria advogada.

A rota `/` é a landing page pública da Repassum, com apresentação, recursos, segurança e contato. O botão **Acessar** leva a `/login`; `/app` continua direcionando a pessoa autenticada à área do seu cargo. A landing é estática e não consulta perfis ou dados financeiros; os valores no painel de vidro são exemplos identificados como ilustrativos. O bypass no proxy se limita à rota `/`, preservando a autenticação das áreas internas.

O fundo da apresentação fica em `public/landing/repassum-still-life.webp`, otimizado a partir da arte preparada com a referência fornecida. Cormorant Garamond é usada somente na landing, com fontes locais e licença em `src/app/fonts/CormorantGaramond-OFL.txt`; a aplicação mantém Inter. Para habilitar um link de contato por e-mail, defina a variável opcional `REPASSUM_CONTACT_EMAIL` e refaça o build/deploy. Sem ela, a seção orienta a pessoa a procurar o administrador do escritório. Esta etapa não exige migration SQL.

## Estrutura

```text
src/app/
  login/                     autenticação
  auth/confirm/              aceitação de convite
  definir-senha/             senha criada pela pessoa convidada
  advogada/                 contratos, indicadores, fechamentos e inadimplência
    notificacoes/            central de avisos e leitura
    novo-contrato/           importação de PDF e cadastro manual
    contratos/[id]/          detalhe e PDF temporário
  secretaria/                operação, clientes, pagamentos e cobranças
  gestor/                    painel, fechamento, repasses e correções
  administracao/             convites e gestão de usuários
  admin/users/               entrada alternativa para administração
  api/contracts/extract/     leitura temporária do PDF no servidor
src/components/              interface reutilizável
src/lib/
  auth/                      perfil e controle de função
  contracts/                 CPF, parser de PDF, cronograma, centavos e indicadores
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
3. Aplique as migrations na ordem dos nomes, com `supabase db push` após vincular o projeto pela CLI ou executando cada arquivo em **Supabase → SQL Editor**. Execute somente os arquivos ainda pendentes. Para um projeto já atualizado até `20261022000500_contract_service.sql`, a atualização atual é `20261022000600_secretary_notifications.sql`. O build do Next.js não aplica SQL automaticamente.
4. Em **Authentication → Providers → Email**, mantenha Email habilitado e desative cadastro público (**Allow new users to sign up**). Desative login anônimo. `supabase/config.toml` faz isso no ambiente local da CLI; no projeto hospedado, configure pelo Dashboard.
5. Em **Authentication → URL Configuration**, informe a Site URL correta (por exemplo, `http://localhost:3001` durante desenvolvimento e a URL da Vercel em produção). Em **Email Templates**, copie [invite.html](supabase/templates/invite.html) para **Invite user** e [recovery.html](supabase/templates/recovery.html) para **Reset password**. Os links abrem páginas com botão de confirmação, evitando consumo automático do token por verificadores de e-mail. Configure SMTP adequado para uso real.
   Para recuperação em produção, use Site URL `https://repassum.vercel.app` e autorize `https://repassum.vercel.app/auth/recovery` nos Redirect URLs. O endereço deve incluir `https://`. Veja [configuração e diagnóstico da recuperação](docs/recuperacao-de-senha.md).
6. Confira o bucket privado `contract-pdfs` criado pelas migrations. Ele aceita somente PDF de até 10 MiB. Não o torne público. A importação usa esse bucket temporariamente porque a Vercel limita o corpo de uma função a 4,5 MB; o arquivo de análise é removido antes da confirmação. O PDF definitivo só é enviado na confirmação. Se a conexão cair imediatamente após o upload, um arquivo não vinculado pode permanecer; faça a limpeza pela API de Storage, nunca apagando diretamente `storage.objects`.
7. Rode `npm run dev` e acesse `/login`. No Windows, se Node emitir `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, use `npm run dev:system-ca` para confiar nos certificados do Windows.

### Se uma migration acusar objeto já existente

Cada arquivo de `supabase/migrations` foi feito para ser aplicado **uma vez**, na ordem. O erro `function "revise_manager_payment" already exists with same argument types` aparece ao executar novamente a criação dessa função em `20261002000100_closings_management.sql`. A migration `20261002000200_payment_integrity.sql` atualiza a função com `CREATE OR REPLACE`; não execute o trecho antigo outra vez.

`20261002000300_contract_import.sql` usa transação e tolera reexecução sem recriar objetos; ainda assim, aplique-o somente depois de confirmar que as migrations anteriores estão completas. Se houver erro, não publique o novo código até conferir o estado do banco.

Antes de repetir qualquer SQL, execute [check_management_migrations.sql](supabase/diagnostics/check_management_migrations.sql) no SQL Editor. Ele apenas consulta os objetos existentes. Se todos os 11 itens de `20261002000100` estiverem presentes e nenhum dos 9 itens de `20261002000200` estiver presente, aplique somente a segunda migration. Se ambas estiverem completas, não reaplique nenhuma. Se houver itens ausentes em uma migration parcialmente aplicada, guarde o resultado e o primeiro erro completo para preparar uma correção específica; não use `DROP FUNCTION`, `DROP TABLE` ou `CREATE IF NOT EXISTS` às cegas, pois isso pode ocultar diferenças de esquema e afetar RLS ou dados. O SQL Editor não registra automaticamente as migrations no histórico da CLI; mantenha o mesmo método até reconciliar esse histórico.

Se o diagnóstico mostrar exatamente **1/11** para `20261002000100` (apenas `private.revise_manager_payment`) e **9/9** para `20261002000200`, a segunda migration foi aplicada antes da primeira. Execute uma vez [20261002_out_of_order_management.sql](supabase/repairs/20261002_out_of_order_management.sql) no SQL Editor e rode novamente o diagnóstico: o esperado é **11/11** e **9/9**. O reparo verifica esse estado antes de começar, aplica a migration de fechamentos em uma transação e preserva a versão mais nova da função de pagamento. Não execute o reparo para nenhum outro resultado.

### Escritórios e primeiro admin

A migration `20261006000100_offices_rbac.sql` cria `offices` e vincula a ele todos os dados e usuários existentes. A migration `20261006000200_rename_initial_office.sql` nomeia o escritório inicial como “HP Consultoria Jurídica”. Os perfis antigos com `role = 'admin'` são convertidos para `role = 'manager'` e `is_office_admin = true`; assim, continuam podendo administrar usuários e também recebem o acesso financeiro de gestor. Na tela de administração, o cargo (`lawyer`, `secretary` ou `manager`) e o acesso “Admin do escritório” são campos independentes.

Para um projeto novo, crie o primeiro usuário por **Authentication → Users → Add user → Send invitation**. O trigger cria um perfil inativo e sem escritório. No SQL Editor, vincule essa conta ao escritório principal, escolha o cargo operacional adequado e habilite o admin do escritório:

```sql
update public.profiles
set full_name = 'Nome da pessoa',
    role = 'manager', -- use lawyer, secretary ou manager
    office_id = (select id from public.offices where slug = 'principal'),
    is_office_admin = true,
    active = true
where id = (select id from auth.users where email = 'admin@exemplo.com');
```

Confirme que exatamente uma linha mudou. Depois, essa pessoa acessa `/administracao` e convida outros usuários para o mesmo escritório, com qualquer cargo e, opcionalmente, com permissão administrativa. Cada usuário pertence a um escritório. Um admin do escritório só consegue gerenciar usuários e dados daquele escritório. A criação de escritórios adicionais é provisionada por um operador do Supabase; não há um papel global que possa atravessar todos os escritórios.

Para provisionar outro escritório, um operador do Supabase cria a linha do escritório pelo SQL Editor e convida a primeira pessoa pelo Auth. Depois, vincula o perfil recém-criado ao escritório e concede a permissão de admin. Por exemplo:

```sql
insert into public.offices(name, slug) values ('Escritório Exemplo', 'escritorio-exemplo');

update public.profiles
set full_name = 'Nome do Admin',
    role = 'manager',
    office_id = (select id from public.offices where slug = 'escritorio-exemplo'),
    is_office_admin = true,
    active = true
where id = (select id from auth.users where email = 'admin@outro-escritorio.com');
```

Após essa configuração, o admin daquele escritório convida o restante da equipe. A interface não permite criar escritórios nem mover pessoas entre eles; essas operações de provisionamento ficam restritas ao operador do Supabase.

### Identidade Repassum e marca do escritório

A marca da plataforma é **Repassum**. Os SVGs ficam em `public/branding/repassum/`; no logotipo, o símbolo forma o R inicial e se une às letras “epassum”. A paleta usa petróleo `#123439`, verde `#24A78B` e menta `#B3E8D5`. Botões usam verde mais escuro para garantir contraste com texto branco. Inter Variable é servida localmente por `next/font/local`; sua licença está em `src/app/fonts/OFL.txt`.

O logo do escritório é independente e aparece junto ao nome carregado de `offices`. A migration `20261017000100_office_branding.sql` provisiona o logo original da HP Consultoria Jurídica para o piloto, adiciona `offices.logo_path` e cria o bucket privado `office-logos`. Escritórios sem logo usam o nome e as iniciais, sem condicionais por cliente na interface.

Em **Administração → Identidade do escritório**, qualquer admin do escritório pode enviar ou remover o logo (PNG, JPG ou WebP, até 2 MB). O servidor verifica tamanho, MIME e assinatura do arquivo. Storage e RPC validam o escritório pelo usuário autenticado; o cliente não escolhe qual escritório será alterado. Cada mudança gera auditoria, e o arquivo em uso não pode ser excluído diretamente. URLs assinadas exibem os logos privados; a arte da HP fornecida para o piloto é um arquivo estático público. A alteração não concede acesso financeiro adicional.

Antes de aplicar a nova migration, a plataforma continua exibindo o nome e as iniciais; o formulário de personalização fica indisponível. Depois, recarregue a página. Para o Supabase hospedado, atualize também os assuntos e o conteúdo de **Invite user** e **Reset password** em **Authentication → Email Templates** com os arquivos de `supabase/templates/`, que já usam Repassum. Alterar os arquivos locais não muda automaticamente os templates hospedados. O identificador local `project_id` e o repositório mantêm seus nomes técnicos anteriores para preservar os vínculos existentes.

## Regras financeiras

- `installments.contractual_amount` é o valor previsto. `payments.amount_paid` é o valor efetivamente recebido, inclusive pagamentos parciais e juros. Uma parcela pode ter vários pagamentos.
- Contratos com início condicionado guardam a condição, quantidade e valores pactuados, sem criar parcelas até existir um primeiro vencimento real. A última parcela pode ter valor diferente para fechar centavos, desde que a advogada a informe explicitamente.
- Honorários adicionais eventuais ficam em `contracts.has_additional_fee`, `additional_fee_percentage`, `additional_fee_basis` e `additional_fee_amount`. Eles não entram no principal, nas parcelas nem na comissão da advogada.
- O gatilho de pagamento cria `commissions` com percentual do contrato e valor recebido. O percentual não vem do perfil atual da advogada.
- O fechamento usa `payments.payment_date` no mês-calendário. Só pode ser confirmado no último dia desse mês ou depois. A prévia mostra todos os pagamentos válidos antes da confirmação.
- `monthly_closing_items` conserva cliente, origem, data, pagamento, percentual e comissão originais. Uma correção posterior mantém esses itens e cria `closing_adjustments`. O saldo atual do fechamento considera os ajustes.
- Um fechamento aceita vários `commission_transfers`. A soma ativa é o valor repassado; repasse maior que o saldo é rejeitado. Uma reversão exige motivo e preserva o registro original.
- A secretaria não consegue inserir um pagamento com data de mês já fechado. O gestor usa **Lançamento complementar**, que insere o pagamento e o ajuste na mesma transação, com auditoria e notificação.
- A advogada vê em **A receber** o saldo acumulado de todas as comissões efetivas ativas menos todos os repasses ativos, inclusive comissões de mês ainda não fechado. A estimativa contratual e a participação potencial de parcelas vencidas ficam identificadas separadamente.
- O prazo de 30 dias após o fechamento é um indicador gerencial; nunca bloqueia o repasse.

## Áreas e segurança

Na operação da secretaria, a coluna **Ação** da própria parcela lista cada recebimento ativo com **Editar registro** e **Excluir registro** para quem o lançou. A edição e a exclusão usam a RPC auditada existente e exigem motivo; excluir estorna o recebimento, preserva o original no histórico e recalcula o saldo, sem apagar a parcela contratual. Em **Registrar pagamento**, o valor normal da parcela e sua data de vencimento já vêm preenchidos e podem ser alterados antes de confirmar. Havendo recebimentos ativos, o formulário aparece como **Registrar outro pagamento**. Continuam valendo a autoria e o bloqueio de meses fechados no banco.

| Perfil | Acesso |
| --- | --- |
| `lawyer` | Somente contratos, clientes associados, parcelas, pagamentos, comissões, fechamentos, repasses e notificações da própria conta. Pode cadastrar contrato por PDF ou manualmente, mas não registrar recebimentos ou repasses. |
| `secretary` | Dados operacionais de clientes, contratos, parcelas, pagamentos e notas. Não lê percentual, comissão, fechamento, repasse ou auditoria. Registra pagamentos e corrige somente lançamentos próprios de meses abertos. |
| `manager` | Vê advogadas e dados financeiros do próprio escritório. Confirma fechamentos, registra/reverte repasses e corrige informações por RPC com motivo. |
| Admin do escritório | Permissão adicional que pode ser combinada com qualquer cargo. Convida usuários e gerencia nome, cargo, ativação e outros admins somente no próprio escritório. |

As tabelas expostas possuem RLS e grants explícitos. Além das políticas, triggers de escopo e as rotinas privilegiadas validam o `office_id`; isso impede acesso cruzado mesmo por operações executadas com `SECURITY DEFINER`. A maioria das mutações financeiras não tem permissão direta de `UPDATE`/`DELETE`; `audit_logs` rejeita alterações e exclusões. Alterações de usuário passam por `manage_office_profile`, gravam auditoria com motivo e não permitem remover o último admin ativo do escritório nem tirar o cargo `lawyer` de quem tem histórico financeiro. Usuários inativos ou sem escritório não passam pelas políticas nem pelas páginas protegidas.

O gestor corrige pagamento por estorno lógico e substituição; o original e sua comissão permanecem acessíveis para auditoria. Corrigir percentual atualiza as comissões válidas, registra cada diferença e adiciona ajustes aos meses fechados, preservando os itens originais do fechamento. Corrigir valor total do contrato **não** modifica as parcelas automaticamente; o gestor deve conferir e corrigir o cronograma, cada mudança com motivo.

## Banco

Migrations novas desta etapa:

| Arquivo | Conteúdo |
| --- | --- |
| `20261002000100_closings_management.sql` | Itens de fechamento, ajustes, repasses, índices, RLS e funções de fechamento, transferência, correção e gestão de perfis. |
| `20261002000200_payment_integrity.sql` | Bloqueio de pagamentos retroativos em meses fechados, lançamento complementar do gestor e auditoria de criações. |
| `20261002000300_contract_import.sql` | Campos de início condicionado, parcelas pactuadas e honorários adicionais; RPC transacional para cadastro manual ou com PDF. |
| `20261006000100_offices_rbac.sql` | Tabela `offices`, vínculo de tenant, admin adicional por perfil, políticas RLS e guards para dados, RPC de gestão de usuários e CPF único por escritório. |
| `20261006000200_rename_initial_office.sql` | Define o nome do escritório piloto como HP Consultoria Jurídica. |
| `20261017000100_office_branding.sql` | Logo por escritório, marca HP do piloto, Storage privado, políticas por escritório e RPC administrativa com auditoria. |
| `20261022000100_contract_client_conflict.sql` | Corrige o `ON CONFLICT` do cadastro de contratos para o índice parcial de CPF por escritório, preservando cadastros existentes. Pode ser reaplicada. |
| `20261022000200_success_only_contracts.sql` | Forma de pagamento apenas no êxito, percentual cobrado do cliente, valor principal desconhecido (`NULL`), RPC com validação de escritório/PDF e bloqueios de cronogramas fictícios. |
| `20261022000300_lawyer_contract_management.sql` | Detalhes, edição transacional e exclusão lógica dos próprios contratos, com versão, motivo e auditoria. |
| `20261022000400_multiple_contractors.sql` | Vários contratantes vinculados ao mesmo contrato e cronograma, com isolamento por escritório e advogada. |
| `20261022000500_contract_service.sql` | Serviço contratado / nome da ação no cadastro, edição com histórico e consulta futura. Ver [orientações](docs/servico-contratado.md). |
| `20261022000600_secretary_notifications.sql` | Notificações de recebimentos, edições, exclusões e cobranças da secretaria, sem duplicar avisos durante uma correção. Ver [orientações](docs/notificacoes-operacionais.md). |

Tabelas existentes: `profiles`, `clients`, `contracts`, `contract_financial_terms`, `installments`, `payments`, `commissions`, `collection_notes`, `monthly_closings`, `audit_logs`, `notifications`. Novas tabelas: `offices`, `monthly_closing_items`, `closing_adjustments`, `commission_transfers`. Índices cobrem escritório, advogada, período, data de pagamento, vencimento, repasses, notificações e busca de auditoria por registro.

## Rodar e verificar

```powershell
npm run lint
npm run typecheck
npm run build
npm test
```

Os testes SQL existentes cobrem as migrations financeiras e verificam RLS, separação de valores, pagamentos parciais/múltiplos, mudança de mês, snapshot de fechamento, repasses parciais/múltiplos, reversão, correção posterior, ajustes, auditoria, notificações e alterações administrativas. O teste de branding aplica todas as migrations em sequência e verifica dois escritórios, autorização de upload, leitura isolada dos logos, bloqueio de exclusão do arquivo em uso, auditoria e múltiplos admins sem trocar o cargo de advogada. Os testes do parser cobrem data fixa, condição, pagamento à vista, honorários adicionais, campos ausentes, variações de espaço e PDFs inválidos ou sem texto. PDFs digitalizados sem camada de texto precisam de cadastro manual nesta etapa. O fluxo de e-mail e uploads no projeto hospedado exige verificação com contas fictícias, pois depende dos serviços externos Supabase Auth, SMTP e Storage.

O teste de cadastro multi-escritório executa todas as migrations e a RPC real: verifica reutilização do cliente no mesmo escritório, CPF igual em escritórios distintos, isolamento RLS, bloqueio da secretaria e rollback de cronograma inválido. A extração de CPF e data tolera palavras/espaços unidos na camada de texto do PDF, mas mantém a validação de CPF e calendário; não corrige dígitos nem realiza OCR de imagens.

Se o cadastro retornar `there is no unique or exclusion constraint matching the ON CONFLICT specification` em um banco já atualizado para múltiplos escritórios, execute `20261022000100_contract_client_conflict.sql` no SQL Editor do Supabase. O deploy da Vercel não aplica essa correção no banco automaticamente.

### Apenas no êxito e acompanhamento

No cadastro, **Forma de pagamento → Apenas no êxito** pede o percentual contratual cobrado do cliente (por exemplo, 30%). A data de assinatura do contrato e os dados internos continuam no cadastro; nenhum valor principal, parcela, entrada ou vencimento é exigido. `success_fee_percentage` é separado da participação da advogada em `contract_financial_terms`. O valor principal permanece desconhecido (`NULL`), sem gerar estimativas financeiras ou inadimplência.

O menu **Acompanhamento** (`/acompanhamento`) reúne automaticamente contratos apenas no êxito, com honorários adicionais/proveito econômico ou com início condicionado. Os filtros de tipo, cliente e advogada podem ser combinados; um contrato que atende a dois motivos aparece uma única vez. As advogadas consultam somente seus contratos. Secretaria e gestão consultam os contratos do próprio escritório, e a consulta operacional não inclui percentuais internos nem comissões. A secretaria pode abrir o histórico existente do cliente.

A RPC `create_success_contract` usa a usuária autenticada como responsável e obtém o escritório no banco. A criação é atômica, inclusive o reaproveitamento do cliente e a gravação da participação interna. Constraints e triggers impedem valor artificial ou parcelas em contratos apenas no êxito. O acompanhamento é manual; converter um resultado em cobrança e definir seus valores/vencimentos exige um fluxo posterior. Para verificar esta mudança sem executar toda a suíte: `node --import tsx --test tests/success-contracts.test.ts tests/office-contract-registration.test.ts`.

## Vercel

Importe o repositório como projeto Next.js. Configure as três variáveis de `.env.example` em **Project Settings → Environment Variables** nos ambientes necessários. `SUPABASE_SECRET_KEY` deve ficar apenas no ambiente de servidor. Execute as migrations no Supabase **antes** de publicar a versão. Configure a Site URL e templates para o domínio final. O comando de build é `npm run build`; não há dependência de servidor próprio ou cron nesta etapa.

### Diagnóstico de login

O login distingue credenciais inválidas, e-mail não confirmado, limite de tentativas e indisponibilidade do Auth. Falhas operacionais registram somente código, status e nome do erro no servidor, sem senha, token ou e-mail informado.

Se o endereço `NEXT_PUBLIC_SUPABASE_URL` retornar `ENOTFOUND`/`NXDOMAIN`, confira a URL copiada do projeto e seu estado no painel Supabase. Um projeto pausado precisa ser restaurado antes que o login volte a funcionar. Ao mudar o domínio da aplicação, atualize **Authentication → URL Configuration** (Site URL e Redirect URLs) para os fluxos de convite e recuperação. A troca de domínio não altera as senhas cadastradas. Consulte o [guia de DNS do Supabase](https://supabase.com/docs/guides/troubleshooting/nxdomain-error-connecting-to-a-supabase-project).
