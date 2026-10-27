# Product research and scope

This independent portfolio application is inspired by publicly described wellness and consultation capabilities; it is not affiliated with Amrutam and does not reproduce its product or internal systems.

## Publicly visible context

The Amrutam home page publicly promotes wellness content and health products. Its Amrutam Home app privacy notice (last updated February 1, 2024) says the service may process information depending on how a person uses its services, including personal and potentially sensitive information. The website privacy policy describes account and order-related information collection. These statements are summaries of the cited public pages, not an audit of their current practices.

- [Amrutam home](https://amrutam.co.in/pages/home)
- [Amrutam Home app privacy policy](https://amrutam.co.in/pages/amrutam-home-app-privacy-policy)
- [Amrutam privacy policy](https://amrutam.co.in/pages/privacy-policy)

The references are marketing and privacy pages, not a public technical specification. Specific workflows below are therefore product assumptions for this implementation, not claims about Amrutam's application.

## Assumed journeys

- **Patient:** register, find a verified practitioner, inspect available slots, book/cancel, and view their own appointment history.
- **Doctor:** be verified by an administrator, publish availability, and view assigned appointments. Clinical-note and prescription authoring remain planned work.
- **Administrator:** approve practitioner profiles and review aggregate operations without accessing clinical details in analytics.

## Privacy and assumptions

The system deliberately limits public practitioner fields, scopes appointment lists to the authenticated user, uses synthetic seed data, and avoids clinical information in log messages. Health and identity information are sensitive. A local demo is not a suitable repository for real patient data.

Privacy notices are not legal advice. Applicability of Indian privacy, telemedicine, medical-practice, retention, and consent requirements depends on the operator and use case; this project does not establish compliance. Obtain qualified legal and clinical review before any real-world use.

## Exclusions

No payment processing, video calls, AI diagnosis, production deployment, certification, or connection to Amrutam systems. Redis, worker queues, MFA, complete clinical workflows, and compliance controls are not implemented in this initial local MVP.
