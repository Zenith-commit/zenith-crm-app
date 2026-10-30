# Zenith CRM

Job management for Zenith Roof Restorations and Replacements: taking a roofing Job from first call, through inspection, quoting, booking and the work itself, to invoicing.

## Language

### People

**Client**:
The person or company Zenith does work for and bills.
_Avoid_: Customer, account

**Job Contact**:
A person to call about one specific Job instead of the Client, e.g. a tenant or site foreman. Never changes the Client's own details.
_Avoid_: Site contact, secondary contact

**Staff**:
Admin and Office together: everyone who isn't a Technician.
_Avoid_: Office (that's one role), back office

**Admin**:
A Staff member with full control, including permanent deletes and reading Staff Feedback.
_Avoid_: Owner, manager

**Office**:
A Staff member who runs day-to-day quoting, billing and booking.
_Avoid_: Admin staff, receptionist

**Technician**:
A field worker who does the roofing work. Sees only the Jobs they have a Confirmed Booking on, and never sees costs, markup or prices.
_Avoid_: Tech, worker, field staff, installer

### Jobs

**Job**:
One piece of roofing work for a Client at one Site Address, from first enquiry to completion.
_Avoid_: Project, work order (that's a Job Status)

**Job Number**:
A Job's permanent sequential number, shown as `Job #0012`. Every Job gets one at creation, including Quotes.
_Avoid_: Job ID, reference

**Site Address**:
Where a Job's work happens. Can differ from the Client's own address.
_Avoid_: Job address, property address

**Job Status**:
Where a Job sits in the pipeline: Quote → Work Order → Scheduled → Completed.
_Avoid_: Stage, phase

**Quote** (status):
A Job not yet accepted: still being inspected and priced. Not a document.
_Avoid_: Estimate, lead

**Work Order** (status):
A Job the Client has accepted, still waiting for its work to be booked.
_Avoid_: Accepted, approved

**Scheduled** (status):
A Job with its work booked. A Job moves here on its first Confirmed Work Booking and back to Work Order if the last one is removed.
_Avoid_: Booked

**Completed** (status):
A Job whose work is done. A later return visit, e.g. warranty, doesn't reopen it.
_Avoid_: Closed, finished

**Queue**:
A Staff-made folder for organising Jobs, separate from Job Status. A Job is in at most one Queue, or none (Unqueued).
_Avoid_: Folder, list, inbox

**Diary**:
A Job's running log of notes and photos, visible to Staff and the Job's Technicians.
_Avoid_: Notes, job log

### Scheduling

**Booking**:
One Technician's time on one Job on one day. Work spanning several days is one Booking per day.
_Avoid_: Schedule entry, appointment, assignment

**Inspection** / **Work**:
The two kinds of Booking. A Booking on a Quote is an Inspection; on any later status it is Work. The kind never changes after the Booking is made.
_Avoid_: Visit type, site visit

**Tentative** / **Confirmed**:
A Tentative Booking is a pencilled-in option; a Confirmed Booking is locked in. A Job's first Booking of each kind starts Tentative, and Confirming one cancels the other Tentative Bookings of that kind. Technicians only ever see Confirmed Bookings.
_Avoid_: Pending, hold, draft

**Assigned Technician**:
Any Technician with a Confirmed Booking on a Job. There is no separate assignment.
_Avoid_: Assignee, owner

**Unscheduled Job**:
A Job still needing a Booking: a Quote with no Confirmed Inspection, or a Work Order or Scheduled Job with no Confirmed Work.
_Avoid_: Backlog, unassigned job

**Dispatch Board**:
The Staff view of every Booking, laid out by Technician and day.
_Avoid_: Calendar, schedule, diary

### Catalog and Bundles

Reusable across Jobs. Editing one never changes a Job that already used it.

**Catalog Item**:
One material or service Zenith sells, with its cost and price.
_Avoid_: Material (it can be a service), product

**Bundle**:
A named, reusable set of Bundle Items for a type of Job, e.g. "Concrete Roof Restoration".
_Avoid_: Template, kit, package

**Bundle Item**:
One line in a Bundle: a Catalog Item with a default quantity and markup.
_Avoid_: Bundle line, line item (ambiguous with Job Line Item)

### Job billing

**Job Line Item**:
One priced line on a Job: quantity, cost and markup. Editable at any time; never billed until it appears on an Invoice.
_Avoid_: Job cost, cost line, line item (ambiguous with Bundle Item)

**Applied Bundle**:
One application of a Bundle to a Job, and the group of Job Line Items that belong to it. The same Bundle can be applied to a Job more than once.
_Avoid_: Bundle group, job bundle

**One-off Line**:
A Job Line Item that belongs to no Applied Bundle.
_Avoid_: Extra, manual line

**Custom Item**:
A One-off Line with no Catalog Item behind it, for a one-time charge.
_Avoid_: Ad-hoc item

### Invoicing

**Invoice**:
A permanent request for payment on a Job, listing some of its Job Line Items. A Job can have several, e.g. a deposit and a final invoice, numbered `Invoice #0012-A`, `-B`, and so on.
_Avoid_: Bill, quote (Quote is a Job Status, not a document)

**Invoice Line**:
A frozen copy of a Job Line Item, taken when the Invoice was created.
_Avoid_: Invoice item

**Balance Due**:
What's still owed on an Invoice: its total minus the amount paid so far.
_Avoid_: Outstanding, owing

### Documents and messages

**Roof Report**:
A permanent, branded inspection document for a Job, describing the roof with photos, Urgent Repairs and Preventive Repairs. A Job can have several, numbered `Roof Report #0012-A`, `-B`, and so on.
_Avoid_: Inspection report, roof assessment

**Message**:
An email or SMS logged on a Job, either Sent or Received. Technicians see and send SMS only, never email.
_Avoid_: Communication, comms

**Staff Feedback**:
A private note anyone using the app sends to Admin, optionally with photos. Only Admin can read it.
_Avoid_: Feedback (ambiguous with the Client's feedback on the app), suggestion

## Relationships

- **Client → Job**: a Client has many Jobs; each Job belongs to one Client.
- **Job → Job Contact**: a Job has at most one Job Contact.
- **Job → Booking → Technician**: a Job has many Bookings; each Booking is for one Technician. A Job's Assigned Technicians are whoever holds its Confirmed Bookings.
- **Booking → Job Status**: Confirming a Job's first Work Booking moves it from Work Order to Scheduled; removing its last Confirmed Work Booking moves it back. Inspections never change Job Status.
- **Queue → Job**: a Queue holds many Jobs. Deleting a Queue leaves its Jobs Unqueued, never deletes them.
- **Catalog Item → Bundle Item**: each Bundle Item refers to one Catalog Item.
- **Bundle → Bundle Item**: a Bundle has many Bundle Items.
- **Bundle → Applied Bundle → Job Line Item**: applying a Bundle creates one Applied Bundle and copies each Bundle Item into a Job Line Item in it. A line duplicated inside an Applied Bundle also joins it. Removing the Applied Bundle removes all of its lines and nothing else.
- **Job Line Item → Invoice Line**: creating an Invoice copies the chosen Job Line Items into Invoice Lines. One Job Line Item can appear on more than one Invoice.

## Example

1. A Client calls about a leaking roof. Staff create Job #0012 as a Quote, with the rental property as its Site Address and the tenant as its Job Contact.
2. Staff pencil in two Tentative Inspections on the Dispatch Board, then Confirm Tuesday. The other one is cancelled.
3. The Technician inspects the roof and logs notes in the Diary. Staff write up Roof Report #0012-A with the inspection photos.
4. Staff apply the "Concrete Roof Restoration" Bundle (paint, sealant, labour). That creates one Applied Bundle holding three Job Line Items. They add a skip-bin hire as a Custom Item, which is a One-off Line.
5. The Client accepts, so the Job becomes a Work Order. Staff book the first day of Work, which starts Tentative, and Confirm it. The Job becomes Scheduled. Days two and three are then booked straight as Confirmed.
6. Staff invoice the paint and labour as a deposit: Invoice #0012-A, with two Invoice Lines. Raising the paint quantity afterwards doesn't change that Invoice.
7. The work is done and the Job becomes Completed. A warranty visit six months later is a Confirmed Work Booking; the Job stays Completed.
