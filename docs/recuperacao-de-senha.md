# Recuperação de senha

## Configuração do Supabase hospedado

Em **Authentication → URL Configuration**:

1. Definir **Site URL** como `https://repassum.vercel.app`, com `https://` e sem acrescentar caminhos.
2. Adicionar `https://repassum.vercel.app/auth/recovery` aos **Redirect URLs**.
3. Manter os demais destinos válidos de convite e desenvolvimento. Para desenvolver na porta 3001, adicionar também `http://localhost:3001/auth/recovery`.
4. Salvar as alterações.

Não usar o endereço do projeto Supabase como Site URL nem um domínio sem protocolo, como `controlajus.vercel.app`. Uma URL relativa pode levar o navegador ao domínio do Supabase com o nome da aplicação anexado ao caminho, gerando `requested path is invalid`.

O botão da aplicação envia uma URL absoluta para `/auth/recovery` no domínio em que a recuperação foi solicitada. O Supabase precisa autorizar esse destino na lista acima. Uma URL não autorizada pode fazer o Auth retornar à Site URL configurada.

## Template de e-mail

Em **Authentication → Email Templates → Reset password**, usar o conteúdo de `supabase/templates/recovery.html`. O template abre a aplicação com um `token_hash`; o token só é validado quando a pessoa pressiona **Continuar para nova senha**. A Site URL precisa ser a URL completa e correta para construir esse link. Editar o arquivo local não atualiza o template hospedado.

A rota também aceita o `code` retornado pelo template padrão do Supabase. Esse formato usa PKCE e precisa ser aberto no mesmo navegador em que a recuperação foi solicitada. O template personalizado é o recomendado para manter a confirmação por botão antes da verificação do token e reduzir o consumo antecipado por verificadores de e-mail.

Depois de salvar a configuração e publicar o código, pedir **um novo e-mail** em **Esqueci minha senha**. E-mails enviados anteriormente conservam o endereço antigo; editar a URL manualmente não recria a credencial nem a informação PKCE do navegador.

Esta correção não exige migrations nem novas variáveis de ambiente. Não compartilhar links completos, tokens ou códigos de recuperação.

Referências: [URLs de retorno](https://supabase.com/docs/guides/auth/redirect-urls), [templates de e-mail](https://supabase.com/docs/guides/auth/auth-email-templates).
