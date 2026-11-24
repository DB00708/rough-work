# Orchestration status

Repo: `C:\Users\divya\hackathons\rough_work` (git, branch `main`). Process: `docs/WORKFLOW.md`. Ownership: `docs/CONTRACTS.md`.

## Tasks

| Task | Coder session (name / id) | Branch | Reviewer session | State |
|---|---|---|---|---|
| T1 AI Logic + Nano read + /spike | t1-coder-ai / local_5f86e43a-7af9-4517-b6b0-1e604e8ee25d | task/t1-ai-read | t1-reviewer / local_7ef83158-077d-497d-adae-ee3e1425f1e3 | MERGED (24aa9f2) |
| T2 nerdamer step checker | t2-coder-check / local_2340d82c-934f-403d-8b44-d9b2f54040ab | task/T2-step-check | t2-reviewer / local_7d165164-85d4-4cdd-b5ee-4b26e70f4d0f | in review @ed6d510 |
| T3 webcam capture + line crop | t3-coder-capture / local_432c5fdb-89b6-44a2-9884-29b977942848 | task/T3-capture | t3-reviewer / local_9b8e8a5d-995c-4d08-827a-c0ebb79235c6 | in review @f8d3853 |
| T4 cloud explain, quota, speech | t4-coder-explain / local_44659a34-32ef-4a11-a5a4-ac0653ca91cb | task/T4-explain | t4-reviewer / local_51e01654-8078-412d-beba-b85a35d3d8cb | in review @521f921 |
| T5 Firestore + My mistakes | t5-coder-data / local_ddf65766-b436-4d43-8604-ec84ac8bdaa9 | task/t5-data | t5-reviewer / local_76ca4003-65d6-4916-9161-b8c9110d578c | in review @4085c55 |
| T6 Remote Config, Hosting, README | t6-coder-config / local_19ee461a-00a0-4203-af28-56207ab4a8e9 | task/t6-config-deploy | t6-reviewer / local_43723da3-f191-40d2-9d3f-761dcd34966c | in review @45f4766 |
| T7 practice screen + pipeline | t7-coder-practice / local_4fb63dfc-c0b2-420d-acdb-25f209a0f383 | task/T7-practice | - | coding |

`*` the app may add a prefix/suffix to branch names. Use `git branch -a` to find the real names.

Merge order: T2, T6, T1, T4, T5, T3, then T7 last (it has adapter files to fix up).

## Phase 2 (after all 7 merge)
- T8 integration pass: fix adapters, end-to-end demo mode, build on main.
- T9 polish + Devpost text + demo video script + testing instructions.

## Waiting on the user
- Firebase web config values for `.env.local` (see `.env.example`).
- reCAPTCHA Enterprise site key; App Check debug token registration (user only).
- GitHub repo creation (public, Apache 2.0) and push: needs the user's OK.
