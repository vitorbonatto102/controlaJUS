-- ControlaJUS: modelo inicial. Aplicar antes das políticas.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (length(trim(full_name)) > 0),
  email text not null,
  role text not null default 'lawyer' check (role in ('lawyer', 'secretary', 'manager', 'admin')),
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.profiles is 'Identidade e função; usuário novo começa inativo até aprovação administrativa.';

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) > 0),
  cpf text unique check (cpf is null or cpf ~ '^[0-9]{11}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column public.clients.cpf is 'Apenas dado cadastral; nunca é chave primária ou parâmetro de autorização.';

create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  lawyer_id uuid not null references public.profiles(id),
  origin text not null check (origin in ('Cliente próprio', 'Propriedade Intelectual', 'Tráfego HP')),
  total_contract_value numeric(14,2) not null check (total_contract_value >= 0),
  contract_date date not null,
  contract_file_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.contracts is 'Dados operacionais. Percentual reservado fica em contract_financial_terms.';

create table public.contract_financial_terms (
  contract_id uuid primary key references public.contracts(id) on delete cascade,
  commission_percentage numeric(5,2) not null check (commission_percentage in
    (5,10,15,20,25,30,35,40,45,50,55,60)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.contract_financial_terms is 'Percentual contratual histórico, fora da tabela operacional acessível à secretaria.';

create table public.installments (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id),
  installment_number integer not null check (installment_number > 0),
  due_date date not null,
  contractual_amount numeric(14,2) not null check (contractual_amount >= 0),
  status text not null default 'pending' check (status in ('pending','paid','overdue','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contract_id, installment_number)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  installment_id uuid not null references public.installments(id),
  payment_date date not null,
  amount_paid numeric(14,2) not null check (amount_paid > 0),
  recorded_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column public.payments.amount_paid is 'Valor recebido, inclusive juros e multa; pode divergir de installments.contractual_amount.';

create table public.commissions (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null unique references public.payments(id),
  lawyer_id uuid not null references public.profiles(id),
  commission_percentage numeric(5,2) not null check (commission_percentage in
    (5,10,15,20,25,30,35,40,45,50,55,60)),
  commission_amount numeric(14,2) not null check (commission_amount >= 0),
  created_at timestamptz not null default now()
);
comment on table public.commissions is 'Snapshot futuro por pagamento efetivo; cálculo e inserção ficam para outra etapa.';

create table public.collection_notes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  contract_id uuid references public.contracts(id),
  author_id uuid not null default auth.uid() references public.profiles(id),
  note_type text not null check (note_type in ('collection','client_reply','renegotiation','general')),
  content text not null check (length(trim(content)) > 0),
  created_at timestamptz not null default now()
);
comment on table public.collection_notes is 'Histórico append-only; notas de cliente sem contrato são somente operacionais.';

create table public.monthly_closings (
  id uuid primary key default gen_random_uuid(),
  lawyer_id uuid not null references public.profiles(id),
  reference_month smallint not null check (reference_month between 1 and 12),
  reference_year smallint not null check (reference_year between 2000 and 9999),
  office_amount_received numeric(14,2) not null default 0 check (office_amount_received >= 0),
  commission_amount numeric(14,2) not null default 0 check (commission_amount >= 0),
  amount_already_transferred numeric(14,2) not null default 0 check (amount_already_transferred >= 0),
  amount_pending_transfer numeric(14,2) not null default 0 check (amount_pending_transfer >= 0),
  status text not null default 'draft' check (status in ('draft','closed','paid')),
  closed_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lawyer_id, reference_year, reference_month)
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  affected_lawyer_id uuid references public.profiles(id),
  table_name text not null,
  record_id uuid not null,
  field_name text not null,
  old_value jsonb,
  new_value jsonb,
  reason text not null check (length(trim(reason)) > 0),
  created_at timestamptz not null default now()
);
comment on table public.audit_logs is 'Append-only e sem escrita direta pela API; correções futuras devem usar função/trigger transacional.';

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  type text not null,
  title text not null,
  message text not null,
  related_record_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index on public.contracts (lawyer_id, contract_date);
create index on public.contracts (client_id);
create index on public.installments (contract_id, due_date);
create index on public.payments (installment_id, payment_date);
create index on public.commissions (lawyer_id, created_at);
create index on public.collection_notes (client_id, created_at desc);
create index on public.collection_notes (contract_id, created_at desc);
create index on public.audit_logs (affected_lawyer_id, created_at desc);
create index on public.notifications (user_id, read_at, created_at desc);

create function public.set_updated_at() returns trigger language plpgsql
set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger clients_updated_at before update on public.clients
  for each row execute function public.set_updated_at();
create trigger contracts_updated_at before update on public.contracts
  for each row execute function public.set_updated_at();
create trigger terms_updated_at before update on public.contract_financial_terms
  for each row execute function public.set_updated_at();
create trigger installments_updated_at before update on public.installments
  for each row execute function public.set_updated_at();
create trigger payments_updated_at before update on public.payments
  for each row execute function public.set_updated_at();
create trigger closings_updated_at before update on public.monthly_closings
  for each row execute function public.set_updated_at();

create function public.handle_auth_user() returns trigger language plpgsql security definer
set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)), new.email);
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_auth_user();

create function public.sync_auth_email() returns trigger language plpgsql security definer
set search_path = '' as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row execute function public.sync_auth_email();

-- Valida a vinculação a uma advogada; não depende do nome da pessoa.
create function public.assert_lawyer() returns trigger language plpgsql
set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = new.lawyer_id and role = 'lawyer') then
    raise exception 'lawyer_id deve apontar para um perfil lawyer';
  end if;
  return new;
end;
$$;
create trigger contracts_lawyer before insert or update of lawyer_id on public.contracts
  for each row execute function public.assert_lawyer();
create trigger commissions_lawyer before insert or update of lawyer_id on public.commissions
  for each row execute function public.assert_lawyer();
create trigger closings_lawyer before insert or update of lawyer_id on public.monthly_closings
  for each row execute function public.assert_lawyer();

create function public.ensure_note_contract_client() returns trigger language plpgsql
set search_path = '' as $$
begin
  if new.contract_id is not null and not exists (
    select 1 from public.contracts where id = new.contract_id and client_id = new.client_id
  ) then
    raise exception 'Contrato não pertence ao cliente informado';
  end if;
  return new;
end;
$$;
create trigger notes_contract_client before insert on public.collection_notes
  for each row execute function public.ensure_note_contract_client();

-- Fixa quem efetivamente registrou o pagamento ou anotação pela API.
create function public.set_actor() returns trigger language plpgsql
set search_path = '' as $$
begin
  if tg_table_name = 'payments' then
    new.recorded_by := auth.uid();
  elsif tg_table_name = 'collection_notes' then
    new.author_id := auth.uid();
  end if;
  return new;
end;
$$;
create trigger payments_actor before insert on public.payments
  for each row execute function public.set_actor();
create trigger notes_actor before insert on public.collection_notes
  for each row execute function public.set_actor();

-- Um log não pode ser modificado nem por rotinas privilegiadas acidentais.
create function public.reject_audit_mutation() returns trigger language plpgsql
set search_path = '' as $$
begin
  raise exception 'audit_logs é imutável';
end;
$$;
create trigger audit_immutable before update or delete on public.audit_logs
  for each row execute function public.reject_audit_mutation();
