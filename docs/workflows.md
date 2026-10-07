# Workflows

**Project settings → Workflow** (owners) customises how tickets move through the built-in
statuses. Statuses themselves are fixed (Open, Planned, In Progress, Completed, On Hold, Declined,
Duplicate); a workflow configures how a project uses them.

| Setting                                | Effect                                                                                                                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Enabled statuses                       | Disabled statuses can no longer be chosen (the ticket page doesn't offer them; quick actions, bulk edit, automations and the API reject them). Tickets already in one keep it and their history. |
| Status / priority of new tickets       | Applied to every new ticket (web, widget, API).                                                                                                                                                  |
| Restrict status transitions            | Off: any enabled status. On: only the ticked _from → to_ pairs in the matrix are accepted (and offered on the ticket page).                                                                      |
| Reporters can reopen completed tickets | The reporter gets a **Reopen ticket** button on their own completed ticket; it moves to the status of new tickets.                                                                               |
| Allow comments on completed tickets    | Off: completed tickets are closed for new public comments (staff can still reply and write internal notes).                                                                                      |
| Require a note when changing to …      | The status change needs an explanation (shown publicly with the change).                                                                                                                         |

## Validation

A workflow can only be saved when it is usable – the page checks as you edit and the server
checks again:

- at least one open status (Open, Planned, In Progress or On Hold) is enabled;
- the status of new tickets is enabled and not a resolved status;
- no status transitions to itself or to a disabled status;
- with restricted transitions, tickets starting in the default status can reach a resolved status
  (Completed, Declined or Duplicate).

## Where it applies

The same rules are enforced everywhere a status changes: the ticket page, the ticket list's
quick actions, bulk edit (tickets whose transition isn't allowed are skipped and listed),
automations (the action fails with the reason in the run history), GitHub merge automation and the
REST API (`422`). **Reset to defaults** restores the built-in behaviour. Changes are audit-logged.
