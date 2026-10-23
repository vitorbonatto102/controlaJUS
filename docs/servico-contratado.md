# Serviço contratado / nome da ação

## Ativação

Com as migrations anteriores já aplicadas (inclusive `20261022000400_multiple_contractors.sql`), executar somente `supabase/migrations/20261022000500_contract_service.sql` no SQL Editor do Supabase. O deploy não executa SQL automaticamente. A migration é reaplicável.

## Cadastro e consulta

O campo fica na seção **Contrato**, tanto no cadastro manual quanto após importar um PDF. É obrigatório informar de 2 a 240 caracteres e conferir o texto na revisão. O serviço é preenchido manualmente; a leitura de PDF não presume o objeto contratado.

O nome aparece nos detalhes, na lista de contratos, no Acompanhamento e nos contratos do cliente na secretaria. A busca de contratos aceita cliente ou serviço; a busca do Acompanhamento aceita serviço, condição ou base dos honorários.

Contratos antigos continuam acessíveis e mostram **Não informado**. A advogada pode completar ou corrigir o serviço em **Editar contrato**, inclusive se já houver pagamentos; o motivo e a alteração ficam na auditoria. O nome do serviço é uma informação cadastral, sem alterar os valores ou vencimentos.

## Banco e segurança

`contracts.service_name` guarda o serviço do contrato. A RPC `create_lawyer_contract_v3` exige o campo e grava serviço, contratantes e cronograma em uma única transação, reutilizando as validações e o isolamento das rotinas anteriores. A edição preserva o controle de versão, o motivo obrigatório e a auditoria por campo. Não há nova permissão de escrita direta na tabela, e as consultas continuam usando a sessão autenticada e RLS.

As RPCs antigas permanecem para compatibilidade com versões anteriores. O novo formulário utiliza a RPC v3; se a migration estiver pendente, informa que a atualização do Supabase é necessária, sem descartar silenciosamente o serviço.
