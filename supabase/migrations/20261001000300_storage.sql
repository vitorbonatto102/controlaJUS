-- Bucket reservado a PDFs de contratos. Privado, sem políticas de objetos nesta
-- etapa: uploads/downloads aguardam fluxo com checagem de contrato e autoria.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contract-pdfs', 'contract-pdfs', false, 20971520, array['application/pdf'])
on conflict (id) do nothing;
