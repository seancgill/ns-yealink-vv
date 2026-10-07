# NetSapiens Endpoints provisioning

Use a reusable URL containing platform tokens:

```text
https://voicemail.example.com/yealink_vv?user_id=[[user_1]]&domain=[[domain]]&auth=APP_ACCESS_KEY
```

The Endpoints token list defines `[[user_n]]` as the owner user, `[[domain]]` as customer domain, and `[[device_n]]` as device/auth AOR. For line one, use `[[user_1]]`; an alternate line may use its corresponding owner token if it represents the intended mailbox.

References:
- [NetSapiens: Creating Custom Configuration Files](https://documentation.netsapiens.com/en_US/endpoints-module/854355-creating-custom-configuration-files-in-the-endpoints-module)
- [NetSapiens: Using Custom Override Tokens](https://documentation.netsapiens.com/en_US/device-troubleshooting/using-custom-override-tokens-in-netsapiens-endpoints-module)
- [Yealink XML Browser Developer's Guide](https://support.yealink.com/docs/sip-t22p/yealink-sip-ip-phones-xml-browser-developers-guide-v1-0-pdf/0a1fa0d581c444ebbfe675d2e21caf57)

## Standard Yealink override

Choose an unused key index. For models supporting `linekey.N`, the XML Browser example is:

```text
linekey.1.type="27"
linekey.1.value="https://voicemail.example.com/yealink_vv?user_id=[[user_1]]&domain=[[domain]]&auth=APP_ACCESS_KEY"
linekey.1.label="Voicemail"
```

Set the operator's public app origin and generated app key, retaining the two identity tokens. Place at the appropriate model/domain/device scope. Confirm that tokens inside the override are expanded by that platform's generation pipeline; an accepted override is not proof of delivery.

## Custom format option

A custom format can put the full dynamic URL directly into its template:

```text
linekey.1.type = 27
linekey.1.value = [[vv_origin]]/yealink_vv?user_id=[[user_1]]&domain=[[domain]]&auth=[[vv_key]]
linekey.1.label = Voicemail
```

Supply the custom override tokens at an appropriate scope:

```text
vv_origin="https://voicemail.example.com"
vv_key="APP_ACCESS_KEY"
```

Custom tokens remain literal if unset. Do not introduce a custom format merely for this key if the existing standard format expands the normal override correctly.

## Verify the delivered configuration

1. Read the exact authenticated `/cfg/<mac>.cfg` used by the phone.
2. Confirm the voicemail URL is present and has the intended extension/domain, with no remaining `[[...]]` placeholders.
3. Check locally that the app key matches; do not paste generated SIP passwords or keys into tickets or commit them.
4. Resync only the pilot device, then press its XML Browser key.
5. Confirm folders, metadata, Play, Stop, Back and Forward input. Screen and key support varies by model/firmware; touchscreen InputScreen objects may require native Submit/Exit keys, which this app uses.
6. Use disposable voicemails for action tests. Confirm before/after folders and destination receipt.

Keep MAC-specific overrides and existing line/button assignments intact. NetSapiens override values must be quoted. A sedemotwo T57W provisioning check on 2026-10-05 found an unquoted override persisted but did not appear in delivered configuration.

## Short XML Browser entry URLs

Yealink documents a 99-character limit for programmable/line-key value URLs.
Use the compact entry route when the full app URL exceeds that limit:

```text
programablekey.1.type="27"
programablekey.1.value="https://voicemail.example.com/v?u=[[user_1]]&d=[[domain]]&k=COMPACT_APP_KEY"
programablekey.1.label="Voicemail"
```

The 32-character compact app key is derived using a domain-separated HMAC of PHONE_ACCESS_TOKEN.
It grants the same app access and rotates with PHONE_ACCESS_TOKEN. Never use an API bearer token here.
The app returns XML directly and carries the compact key through normal navigation.
Proxy /v with the same network restrictions and secret-safe logging as /yealink_vv.
Measure the generated URL after Endpoints expands the mailbox tokens: extension/domain/hostname lengths affect the 99-character limit.
Softkey 1 normally replaces History. Preserve the other softkeys and existing device overrides.
