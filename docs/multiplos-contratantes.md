# Múltiplos contratantes

## Ativação

Executar no SQL Editor do Supabase somente `supabase/migrations/20261022000400_multiple_contractors.sql`, depois das migrations anteriores, inclusive `20261022000300`. A migration é reaplicável e vincula os clientes dos contratos existentes como primeiro contratante, sem modificar seus valores.

## Cadastro e leitura

O cadastro permite adicionar/remover pessoas, com nome e CPF individual, até 20 contratantes. Todos os CPFs precisam ser válidos e distintos. A confirmação revisa todas as pessoas e um único cronograma do contrato. O primeiro cadastro continua como referência em `contracts.client_id`, e as demais pessoas são vinculadas pela tabela `contract_parties`.

A leitura aceita o cabeçalho tradicional e apresentações como “de um lado ... doravante denominados contratantes”, sem confundir clientes com a parte contratada. Também reconhece variações de remuneração, entrada, parcelas e data no rodapé. CPFs ilegíveis ou inconsistentes na camada de texto não são corrigidos por suposição: ficam para preenchimento manual, com aviso. Nomes e dados financeiros sempre precisam ser conferidos na revisão. A importação da entrada não registra automaticamente um recebimento.

## Segurança e financeiro

`create_contract_with_parties` grava o contrato e os vínculos em uma única transação, reutilizando as rotinas financeiras já validadas. O banco valida nomes, CPFs, duplicação, escritório e usuário; falhas não deixam cadastros parciais. A RPC é exclusiva da advogada autenticada e a tabela de vínculos não permite escrita direta pela API.

RLS mantém a separação entre escritórios e advogadas, incluindo o acesso ao cadastro dos contratantes adicionais. A secretaria continua recebendo apenas o DTO operacional. Pagamentos, comissões, principal e parcelas são contados uma única vez por contrato, sem rateio automático entre as pessoas.

No PostgREST, o contratante de referência é consultado explicitamente por `clients!contracts_client_id_fkey(...)`, e cada pessoa vinculada por `clients!contract_parties_client_id_fkey(...)`. A tabela de vínculos também cria um relacionamento muitos-para-muitos; usar apenas `clients(...)` a partir de `contracts` torna a consulta ambígua (`PGRST201`).

Detalhes, listagens, Carteira e Acompanhamento exibem as pessoas vinculadas. Os filtros de cliente/CPF reconhecem também os demais contratantes. A secretaria pode acessar o contrato pelo cadastro de qualquer pessoa vinculada, lançar pagamentos e registrar cobranças no mesmo histórico contratual. A edição financeira preserva as identidades vinculadas, conforme a regra já existente de não alterar o cadastro compartilhado do cliente nessa tela.

Enquanto a migration não for aplicada, a consulta continua mostrando o primeiro contratante e o cadastro de uma pessoa continua disponível. Para salvar várias pessoas é necessária a nova RPC.
