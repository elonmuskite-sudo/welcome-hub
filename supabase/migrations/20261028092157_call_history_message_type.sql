alter table public.messages drop constraint if exists messages_text_requires_encryption;

alter table public.messages
  add constraint messages_text_requires_encryption check (
    type in ('reaction', 'receipt', 'image', 'video', 'voice', 'file', 'document', 'call') or (
      encrypted is true
      and jsonb_typeof(content::jsonb) = 'object'
      and (content::jsonb - 'alg' - 'iv' - 'data') = '{}'::jsonb
      and content::jsonb ->> 'alg' = 'ECDH-P256+AES-256-GCM'
      and content::jsonb ->> 'alg' is not null
      and content::jsonb ->> 'iv' is not null
      and content::jsonb ->> 'data' is not null
      and (content::jsonb ->> 'iv') ~ '^[A-Za-z0-9+/]{16}$'
      and (content::jsonb ->> 'data') ~ '^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'
      and length(content::jsonb ->> 'data') >= 24
      and mod(length(content::jsonb ->> 'data'), 4) = 0
      and (3 * (length(content::jsonb ->> 'data') / 4)
        - case
            when right(content::jsonb ->> 'data', 2) = '==' then 2
            when right(content::jsonb ->> 'data', 1) = '=' then 1
            else 0
          end) >= 17
    )
  ) not valid;