# Webhook verification

The provider signs the exact request bytes before transport. Verification must
use those original bytes before JSON parsing. Whitespace and property order are
valid JSON details that must not change the signed input.
