-- Define o nome do escritório inicial já provisionado pela migration anterior.
-- O slug permanece estável para não alterar referências existentes.
update public.offices
set name = 'HP Consultoria Jurídica'
where slug = 'principal'
  and name is distinct from 'HP Consultoria Jurídica';
