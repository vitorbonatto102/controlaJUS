# Carteira da advogada

Rota: `/advogada/carteira`. Acesso exclusivo ao perfil `lawyer`, inclusive quando possuir a permissão adicional de administração.

## Dados e isolamento

A página usa o cliente Supabase autenticado e as políticas RLS existentes. Contratos, fechamentos e repasses também recebem filtro explícito pelo ID da advogada autenticada. Nenhuma consulta utiliza chave administrativa. Não é necessária nova migration.

Os cálculos ficam em `src/lib/contracts/wallet.ts`, em centavos inteiros. A interface interativa fica em `src/components/wallet/`. Gráficos são SVG, sem dependência adicional, com alternativa tabular.

## Como interpretar os indicadores

- **Contratos no mês anterior:** contagem pela data do contrato, relativa ao mês selecionado. A soma considera apenas valores conhecidos; contratos sem valor são contados e sinalizados como a apurar.
- **Recebido dos clientes:** soma de cada pagamento válido pela sua própria data, mesmo quando a parcela venceu em outro mês. Inclui juros e multa efetivamente recebidos.
- **Comissão gerada:** soma das comissões persistidas dos pagamentos válidos. Não é recalculada com percentuais atuais nem substituída por uma estimativa quando não há comissão registrada.
- **Previsão mensal:** saldo positivo de cada parcela contratual, descontados pagamentos válidos, multiplicado pelo percentual histórico do contrato. Pagamentos antecipados saem da previsão. Não é uma promessa de data de repasse.
- **Participação em atraso:** a mesma estimativa de saldo pendente para vencimentos anteriores à data atual em São Paulo, incluindo parcelas parcialmente pagas.
- **Saldo a repassar:** todas as comissões válidas da advogada menos todos os repasses não estornados. Excesso de repasse aparece separadamente. Inclui comissões ainda sem fechamento; não soma ajustes de fechamentos novamente, pois as correções já estão refletidas nos pagamentos/comissões atuais.

## Filtros

Cliente e origem afetam os indicadores, gráficos, totais e a lista de parcelas. O mês de referência define os indicadores mensais, o mês anterior e os próximos seis meses. O gráfico mostra cinco meses anteriores, o mês selecionado e seis seguintes.

Saldo de repasses, histórico de repasses e fechamentos são sempre da carteira completa: os repasses são vinculados a fechamentos, sem alocação por cliente ou contrato.

Na lista, o período filtra **vencimentos**; valores pagos e comissões exibidos são os acumulados da parcela em todos os períodos. É possível selecionar todos os vencimentos, status, inadimplência e data exata. A data exata seleciona automaticamente todos os períodos para não conflitar com o mês do painel.

Contratos apenas no êxito sem valor, adicionais ainda não definidos e início condicionado sem cronograma permanecem em Acompanhamento. Não são projetados como receita garantida.
