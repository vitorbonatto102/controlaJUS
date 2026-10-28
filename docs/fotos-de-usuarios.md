# Fotos dos usuários

## Ativação

No Supabase → SQL Editor, executar somente `supabase/migrations/20261028000300_user_avatars.sql`, depois das migrations anteriores. É transacional e reaplicável. Não preenche fotos automaticamente e não muda nomes, cargos ou permissões. Não exige variáveis de ambiente novas. A migration foi verificada localmente e precisa ser aplicada no Supabase do ambiente.

## Como usar

1. Acesse **Administração → Usuários** com uma conta que tenha a permissão de admin do escritório.
2. Abra **Gerenciar** na linha da pessoa. A edição aparece abaixo, ocupando a largura disponível, com blocos lado a lado para foto, dados e acesso. Em telas pequenas os blocos ficam empilhados.
3. Em **Foto do usuário**, escolha uma imagem PNG, JPG ou WebP de até 2 MB. A seleção apresenta uma prévia local; use **Salvar foto** para efetivar.
4. Para trocar, selecione outra imagem e salve. **Remover foto** volta às iniciais.

A foto aparece junto ao nome na lista de usuários e no cabeçalho da conta correspondente. O envio é independente do formulário de nome/cargo/ativação: não é necessário preencher esses campos para alterar uma foto. Uma foto quadrada fica melhor no recorte circular. Sem imagem, em falhas de carregamento ou antes da atualização do banco, são exibidas as iniciais.

## Segurança e persistência

- `profiles.avatar_path` é apenas uma referência ao bucket privado `user-avatars`; não se aceita URL externa nem metadados do Auth como fonte de permissão.
- Caminho: `<office_id>/<user_id>/<uuid>.<png|jpg|webp>`. O servidor confere tamanho, MIME e assinatura binária. A validação raster é compartilhada com os logos do escritório; SVG não é aceito.
- A Server Action autentica e exige admin; os uploads usam a sessão da pessoa, sem chave administrativa. As políticas do Storage também exigem admin, proprietário do upload e vínculo do usuário ao mesmo escritório.
- Leitura segue as permissões já existentes para perfis no mesmo escritório; administradores também consultam uploads pendentes para completar ou limpar o envio. A URL exibida é assinada e vale por uma hora. O bucket não é público.
- `set_user_avatar` confirma autorização e escritório novamente, verifica a existência e autoria do arquivo, bloqueia o perfil durante a gravação e recusa sobrescrever uma foto alterada por outro admin desde a abertura do formulário.
- A alteração gera auditoria imutável. Um trigger impede trocar a referência pelo fluxo comum de perfis, e o UPDATE direto continua proibido.
- Cada troca usa um novo nome, sem upsert/sobrescrita. Arquivos em uso não podem ser apagados diretamente pelo Storage. O anterior só é removido após confirmar a nova referência. Em erro, o novo arquivo é limpo quando possível; uma falha de limpeza não desfaz a foto já salva.
- A personalização não concede acesso financeiro nem muda a identidade do escritório.

## Verificação

Testes focados em `tests/user-avatars.test.ts`, `tests/office-branding.test.ts` e `tests/server-actions.test.ts`, além de lint, tipagem e build de produção. A integração SQL usa PGlite e não escreve no Supabase de produção.

## Edição cadastral

O motivo da alteração é opcional somente na gestão de usuários. Se preenchido, aceita até 1.000 caracteres; se vazio, a auditoria registra **Motivo não informado pelo administrador**. Nome/cargo, ativação e acesso administrativo continuam auditados e a confirmação da alteração continua necessária.

A migration `20261028000400_optional_profile_reason.sql` atualiza a validação da RPC para aceitar motivo vazio, nulo ou curto. É reaplicável, preserva o isolamento por escritório, o acesso do próprio admin e o cargo das advogadas com histórico financeiro. Não altera a exigência de motivo nos fluxos de correção financeira. A interface envia a anotação padrão quando o campo está vazio, mantendo compatibilidade com o banco anterior enquanto a migration é aplicada.
