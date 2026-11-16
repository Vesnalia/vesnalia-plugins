# Changelog

## 0.1.1

- Check BB-uploaded UTF-8 and BOM-marked UTF-16 text attachments for credentials before dispatch.
- Reject dispatch when an uploaded file cannot be read, without exposing file contents or error details.
- Keep the original text rejection when the message itself contains a credential.
- Show attachment coverage and upload storage limits on the Token Guard page.

## 0.1.0

- Block credentials in messages and scan local agent history.
