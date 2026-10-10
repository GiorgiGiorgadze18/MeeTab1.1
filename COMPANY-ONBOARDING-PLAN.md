# Company and device onboarding — separate future phase

Owner requirement: make company, room, user and administrator additions simple before commercial rollout. This is a requirements record, not an implemented tenant-management interface.

Proposed setup flow: create company → add rooms/calendars → invite identifiable users with scoped roles → enroll room tablets → validate access and activate. Company identities are customer-managed where possible; do not distribute shared human-account passwords.

| Role | Intended scope |
| --- | --- |
| MeeTab operator | Explicit platform administration with strong authentication and audit |
| Company administrator | Own company's users, rooms and settings |
| Company user | Only assigned company/room actions |
| Tablet device | Assigned room calendar/booking/IT request, without human-admin rights |

Before implementation, agree on identity ownership, calendar consent, role grants/revocation and supervised tablet enrollment. Use company-bound identifiers and server authorization for every action. Email prefixes are not isolation. Current global IT administration only manages recipient settings; it does not provide these complete roles or a tablet user directory.

Use the established migration process for company-bound storage; do not silently re-key existing rooms/recipients. Test same-room names in different companies, cross-company read/write denials, role changes/revocation, device loss/replacement and recovery. Paginate company/user lists. Keep operator secrets and provider credentials off devices and out of public configuration.

Ship the tenant model and administrator onboarding in a dedicated branch/PR after the current APK validation phase. Commercial multi-company rollout remains blocked until isolation, organizational consent and the relevant security review pass.
