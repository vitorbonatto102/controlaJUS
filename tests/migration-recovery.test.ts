import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationNames = [
  "20261001000100_schema.sql",
  "20261001000200_rls.sql",
  "20261001000300_storage.sql",
  "20261001000400_lawyer_contracts.sql",
  "20261001000500_secretary_operations.sql",
];

test("reparo preserva a função nova quando integridade é aplicada antes de fechamentos", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth; create schema storage;
      create table auth.users (id uuid primary key, email text not null,
        raw_user_meta_data jsonb not null default '{}'::jsonb);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table storage.buckets (id text primary key, name text not null,
        public boolean not null, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects (bucket_id text not null references storage.buckets(id),
        name text not null, owner_id text, primary key (bucket_id, name));
      create function storage.filename(path text) returns text language sql immutable as $$
        select reverse(split_part(reverse(path), '/', 1)) $$;
      create function storage.foldername(path text) returns text[] language sql immutable as $$
        select string_to_array(regexp_replace(path, '/[^/]+$', ''), '/') $$;
      alter table storage.objects enable row level security;
      grant usage on schema public, auth, storage to authenticated;
      grant select, insert, delete on storage.objects to authenticated;
    `);
    for (const name of migrationNames) {
      await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8"));
    }
    await db.exec(await readFile(new URL(
      "../supabase/migrations/20261002000200_payment_integrity.sql", import.meta.url), "utf8"));

    const diagnosticSql = await readFile(new URL(
      "../supabase/diagnostics/check_management_migrations.sql", import.meta.url), "utf8");
    const before = await db.query<{ migration: string; itens_presentes: number }>(diagnosticSql);
    assert.deepEqual(before.rows.map(({ migration, itens_presentes }) =>
      [migration, itens_presentes]), [["20261002000100", 1], ["20261002000200", 9]]);

    await db.exec(await readFile(new URL(
      "../supabase/repairs/20261002_out_of_order_management.sql", import.meta.url), "utf8"));
    const after = await db.query<{ migration: string; itens_presentes: number }>(diagnosticSql);
    assert.deepEqual(after.rows.map(({ migration, itens_presentes }) =>
      [migration, itens_presentes]), [["20261002000100", 11], ["20261002000200", 9]]);
  } finally {
    await db.close();
  }
});
