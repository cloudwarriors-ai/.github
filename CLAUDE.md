# CloudWarriors AI - Claude Development Standards

This document defines the quality standards, conventions, and requirements for all AI-assisted development in the CloudWarriors AI organization.

**These standards are NON-NEGOTIABLE. Claude agents will enforce them ruthlessly.**

---

## CI / Automation Mode

When Claude is running **non-interactively** (GitHub Actions, autopilot pipelines, `claude --print`), these rules take precedence:

### What You MUST Do
- **Fix the actual issue** described in the prompt — not validation tooling, not CI config
- **Create/update an integration test** that proves the fix works
- **Run the test** before committing to verify it passes
- **Commit with the message format** specified in the prompt
- **Follow the repo's CLAUDE.md** for code style and conventions

### What You MUST NOT Do
- **Do NOT modify** `.github/workflows/` files, `scripts/issues/` files, or CI configuration
- **Do NOT modify** validation scripts, test contracts, or preflight checks
- **Do NOT invoke skills** (`/plan-fix`, `/review-plan`, etc.) — they are not available in CI
- **Do NOT wait for** `.rlm-analysis.json` — if it doesn't exist, proceed without it
- **Do NOT create branches** — the workflow has already set up the branch
- **Do NOT push** — the workflow handles git push

### Branch Conventions
- Autopilot branches: `autofix/issue-<number>` (created by the workflow)
- Manual fix branches: `fix/issue-<number>` (created by developer or skill)
- Base branch: `dev` (not `main`, unless the prompt says otherwise)

### If Blocked in CI
If you cannot complete the fix:
1. Apply whatever partial progress you have
2. Add a code comment `// TODO(autopilot): <description of what's blocking>`
3. Commit what you have — the validation pipeline will catch incomplete fixes
4. Do NOT comment on the GitHub issue (the workflow handles status reporting)

---

## Philosophy

### Excellence Over Expediency

We prioritize **code quality** over **shipping fast**. Mediocre code is worse than no code.

- "It works" is NOT enough
- "Good enough" is the enemy of excellent
- Technical debt is expensive
- Security is paramount
- Tests prove correctness

### Adversarial Quality Assurance (Interactive Mode)

When running interactively with skills available, our workflow uses **adversarial agents**:
- **Planner** creates detailed fix plans
- **Adversarial Supervisor** challenges plans ruthlessly
- **Builder** implements with high standards
- **Adversarial Supervisor** reviews implementations harshly
- **Validator** runs comprehensive quality gates

Plans and implementations must be **bulletproof** to pass.

**Note**: This multi-agent workflow requires interactive skill invocation. In CI/automation mode, Claude operates as a single agent with the quality standards below applied inline.

---

## Question Escalation Policy

When agents have questions or uncertainties, follow this STRICT escalation path.

**In CI/automation mode**: Only Level 1 is available. If you cannot self-resolve, apply your best judgment, document your assumption in a code comment, and proceed. The validation pipeline and human reviewers will catch incorrect assumptions.

### Level 1: Self-Resolution (All Modes)
First, attempt to answer the question yourself:
1. Check this CLAUDE.md document
2. Check `.rlm-analysis.json` for codebase patterns (if it exists — proceed without it if not)
3. Read existing code for examples
4. Review issue description and comments

**Do NOT escalate if the answer is available in these resources.**

### Level 2: Supervisor Review
If you cannot resolve the question:
- **Planner** → Escalate to **Adversarial Supervisor**
- **Builder** → Escalate to **Adversarial Supervisor**

The Supervisor will:
- Review your question
- Provide guidance if possible
- Escalate to Orchestrator if needed

**Format**:
```
QUESTION FOR SUPERVISOR:
Context: [What you're working on]
Question: [Specific question]
What I've tried: [What resources you checked]
Why I can't proceed: [What's blocking you]
```

### Level 3: Orchestrator Review
If Supervisor cannot answer:
- **Supervisor** → Escalate to **Orchestrator** (`/fix-issue`)

The Orchestrator will:
- Review the question in broader context
- Attempt to resolve using available tools
- Escalate to human if necessary

### Level 4: Human Resolution
If Orchestrator cannot answer:
- **Orchestrator** → Post question as **comment on GitHub issue**

**Comment Format**:
```markdown
## Question for Human Review

**Context**: [Brief summary of what we're trying to fix]

**Question**: [Clear, specific question]

**Why We Need Clarification**:
[Explain why we can't proceed without this information]

**Options We're Considering**:
1. Option A: [Description] - [Pros/Cons]
2. Option B: [Description] - [Pros/Cons]

**What We've Tried**:
- [Resource 1 checked]
- [Resource 2 checked]
- [Analysis performed]

**Recommended Option**: [If you have a recommendation]

**Blocking**: [Yes/No - Is this blocking progress?]
```

### Escalation Rules

**NEVER skip levels.** Follow the chain:
```
Agent → Supervisor → Orchestrator → Human
```

**When to escalate immediately to human** (bypass chain):
- Security vulnerability discovered (critical severity)
- Data loss risk
- Production system impact
- Ethical concerns

**Examples of Good vs Bad Escalation**:

❌ **BAD** - Escalating prematurely:
```
Planner: "I'm not sure which file to modify. Asking human."
[Should have used Grep/RLM to find it first]
```

✅ **GOOD** - Proper escalation:
```
Planner: "I found 3 possible files. RLM suggests file A, but business logic
indicates file B. Supervisor, which approach aligns with architecture?"

Supervisor: "RLM shows file A is deprecated. Use file B."
```

❌ **BAD** - Asking vague questions:
```
Planner: "Should I fix this bug?"
[That's literally your job]
```

✅ **GOOD** - Asking specific questions:
```
Builder: "Plan says to modify authentication, but this will break backwards
compatibility with mobile app v1.0. Should we:
1. Add feature flag
2. Maintain both code paths
3. Force mobile app upgrade

Supervisor, what's the standard approach?"
```

---

## Clean Code Principles

We follow Uncle Bob's Clean Code principles religiously.

### Meaningful Names

Names should reveal intent. A reader should understand purpose without looking at implementation.

**Variables**:
```typescript
// ✅ GOOD - Intent is clear
const maxConcurrentConnections = 100;
const isUserAuthenticated = checkAuth(user);
const eligibleUsersForDiscount = users.filter(u => u.tier === 'VIP');

// ❌ BAD - Intent is unclear
const max = 100;
const flag = checkAuth(user);
const list = users.filter(u => u.tier === 'VIP');
```

**Functions**:
```typescript
// ✅ GOOD - Name describes what and why
function calculateMonthlyPaymentWithInterest(principal: number, rate: number): number

// ❌ BAD - Vague or misleading
function calc(p: number, r: number): number
function getData(): number  // What data?
```

**Classes**:
```typescript
// ✅ GOOD - Noun, describes responsibility
class UserAuthenticationService
class PaymentProcessor
class OrderRepository

// ❌ BAD - Verb or vague
class Manager
class Handler
class Helper
```

### Single Responsibility Principle (SRP)

**Every function, class, and module should have ONE reason to change.**

**Bad Example - Multiple Responsibilities**:
```typescript
// ❌ BAD - Does too many things
class User {
  // User data management
  updateProfile(data: ProfileData) { }

  // Email handling
  sendWelcomeEmail() { }

  // Payment processing
  processSubscription() { }

  // Reporting
  generateActivityReport() { }
}
```

**Good Example - Separated Concerns**:
```typescript
// ✅ GOOD - Each class has one responsibility

class User {
  // Only manages user data
  updateProfile(data: ProfileData) { }
  getProfile(): ProfileData { }
}

class EmailService {
  // Only handles email
  sendWelcomeEmail(user: User) { }
  sendPasswordReset(user: User) { }
}

class SubscriptionService {
  // Only handles subscriptions
  processSubscription(user: User, plan: Plan) { }
  cancelSubscription(user: User) { }
}

class ReportingService {
  // Only generates reports
  generateActivityReport(user: User) { }
}
```

### Functions Should Be Small

**Target**: 10-20 lines
**Maximum**: 50 lines (with justification)

**Bad Example - Too Long**:
```typescript
// ❌ BAD - 100+ lines doing multiple things
function processOrder(order: Order) {
  // Validate order (20 lines)
  // Calculate totals (15 lines)
  // Apply discounts (25 lines)
  // Process payment (30 lines)
  // Send confirmation (20 lines)
  // Update inventory (15 lines)
}
```

**Good Example - Extracted Functions**:
```typescript
// ✅ GOOD - Each function is focused and small
function processOrder(order: Order) {
  validateOrder(order);
  const total = calculateOrderTotal(order);
  const finalAmount = applyDiscounts(total, order.user);
  const payment = processPayment(finalAmount, order.paymentMethod);
  sendOrderConfirmation(order, payment);
  updateInventory(order.items);
}

function validateOrder(order: Order) {
  if (!order.items.length) {
    throw new ValidationError('Order must contain items');
  }
  // ... more validation
}

function calculateOrderTotal(order: Order): number {
  return order.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}
```

### Functions Should Do One Thing

**If you can extract another function from a function with a name that's not a restatement, then that function is doing more than one thing.**

```typescript
// ❌ BAD - Does multiple things
function saveUser(userData: UserData) {
  // Thing 1: Validate
  if (!userData.email.includes('@')) {
    throw new Error('Invalid email');
  }

  // Thing 2: Transform
  const normalized = {
    email: userData.email.toLowerCase(),
    name: userData.name.trim()
  };

  // Thing 3: Save
  db.users.insert(normalized);

  // Thing 4: Send email
  emailService.sendWelcome(normalized.email);
}

// ✅ GOOD - Each does one thing
function saveUser(userData: UserData) {
  const validated = validateUserData(userData);
  const normalized = normalizeUserData(validated);
  const user = persistUser(normalized);
  notifyNewUser(user);
}

function validateUserData(data: UserData): UserData {
  if (!data.email.includes('@')) {
    throw new ValidationError('Invalid email');
  }
  return data;
}

function normalizeUserData(data: UserData): NormalizedUserData {
  return {
    email: data.email.toLowerCase(),
    name: data.name.trim()
  };
}

function persistUser(data: NormalizedUserData): User {
  return db.users.insert(data);
}

function notifyNewUser(user: User): void {
  emailService.sendWelcome(user.email);
}
```

### Don't Repeat Yourself (DRY)

**Every piece of knowledge should have a single, authoritative representation.**

```typescript
// ❌ BAD - Repeated logic
function processAdminUser(user: User) {
  if (!user.email.includes('@')) throw new Error('Invalid email');
  if (user.name.length < 2) throw new Error('Name too short');
  if (!user.role) throw new Error('Role required');
  // ... process admin
}

function processRegularUser(user: User) {
  if (!user.email.includes('@')) throw new Error('Invalid email');
  if (user.name.length < 2) throw new Error('Name too short');
  if (!user.role) throw new Error('Role required');
  // ... process regular
}

// ✅ GOOD - Single source of truth
function validateUser(user: User): void {
  if (!user.email.includes('@')) {
    throw new ValidationError('Invalid email');
  }
  if (user.name.length < 2) {
    throw new ValidationError('Name must be at least 2 characters');
  }
  if (!user.role) {
    throw new ValidationError('Role is required');
  }
}

function processAdminUser(user: User) {
  validateUser(user);
  // ... process admin
}

function processRegularUser(user: User) {
  validateUser(user);
  // ... process regular
}
```

### Prefer Composition Over Inheritance

**Favor "has-a" relationships over "is-a" relationships.**

```typescript
// ❌ BAD - Deep inheritance hierarchy
class Animal {
  eat() { }
}

class Bird extends Animal {
  fly() { }
}

class Penguin extends Bird {
  // Problem: Penguins can't fly!
  fly() {
    throw new Error('Penguins cannot fly');
  }
}

// ✅ GOOD - Composition
interface Eater {
  eat(): void;
}

interface Flyer {
  fly(): void;
}

interface Swimmer {
  swim(): void;
}

class Bird implements Eater, Flyer {
  eat() { }
  fly() { }
}

class Penguin implements Eater, Swimmer {
  eat() { }
  swim() { }
  // No fly method - penguins don't fly
}
```

---

## Separation of Concerns

**Different concerns should be in different places.** Business logic, data access, presentation, and infrastructure should be clearly separated.

### Layered Architecture

```
┌─────────────────────────────────────┐
│     Presentation Layer              │  Routes, Controllers, Views
│  (HTTP, API, CLI, UI)              │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│     Application Layer               │  Use Cases, Services
│  (Business Logic)                  │  (orchestration)
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│     Domain Layer                    │  Entities, Value Objects
│  (Core Business Rules)             │  (pure business logic)
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│     Infrastructure Layer            │  Database, External APIs
│  (Data Persistence, External)      │  Email, Storage, etc.
└─────────────────────────────────────┘
```

### Bad Example - Mixed Concerns

```typescript
// ❌ BAD - Everything mixed together
class UserController {
  async createUser(req, res) {
    // Validation (presentation concern)
    if (!req.body.email) {
      return res.status(400).json({ error: 'Email required' });
    }

    // Business logic
    const hashedPassword = await bcrypt.hash(req.body.password, 10);

    // Data access (infrastructure concern)
    const result = await db.query(
      'INSERT INTO users (email, password) VALUES ($1, $2)',
      [req.body.email, hashedPassword]
    );

    // Email sending (infrastructure concern)
    await sendEmail(req.body.email, 'Welcome!');

    // Response (presentation concern)
    return res.status(201).json({ id: result.rows[0].id });
  }
}
```

### Good Example - Separated Concerns

```typescript
// ✅ GOOD - Concerns are separated

// Presentation Layer - HTTP handling only
class UserController {
  constructor(
    private userService: UserService,
    private validator: UserValidator
  ) {}

  async createUser(req, res) {
    try {
      const userData = this.validator.validate(req.body);
      const user = await this.userService.createUser(userData);
      return res.status(201).json(user);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  }
}

// Application Layer - Business logic orchestration
class UserService {
  constructor(
    private userRepository: UserRepository,
    private emailService: EmailService,
    private passwordHasher: PasswordHasher
  ) {}

  async createUser(userData: CreateUserDTO): Promise<User> {
    const hashedPassword = await this.passwordHasher.hash(userData.password);

    const user = new User({
      email: userData.email,
      password: hashedPassword
    });

    await this.userRepository.save(user);
    await this.emailService.sendWelcomeEmail(user.email);

    return user;
  }
}

// Domain Layer - Core business entity
class User {
  constructor(
    public readonly id: string,
    public readonly email: string,
    private readonly password: string
  ) {
    this.validateEmail();
  }

  private validateEmail(): void {
    if (!this.email.includes('@')) {
      throw new DomainError('Invalid email format');
    }
  }

  changePassword(newPassword: string): void {
    // Business rule: password must be strong
    if (newPassword.length < 8) {
      throw new DomainError('Password must be at least 8 characters');
    }
    // ... update password
  }
}

// Infrastructure Layer - Data persistence
class UserRepository {
  constructor(private db: Database) {}

  async save(user: User): Promise<void> {
    await this.db.query(
      'INSERT INTO users (id, email, password) VALUES ($1, $2, $3)',
      [user.id, user.email, user.password]
    );
  }

  async findByEmail(email: string): Promise<User | null> {
    const result = await this.db.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    // ... map to User entity
  }
}

// Infrastructure Layer - External service
class EmailService {
  async sendWelcomeEmail(email: string): Promise<void> {
    // External email API call
  }
}
```

### Benefits of Separation

1. **Testability**: Each layer can be tested independently
2. **Maintainability**: Changes in one layer don't affect others
3. **Flexibility**: Easy to swap implementations (e.g., change database)
4. **Clarity**: Each file has a clear, single purpose

---

## Modularity

**Break systems into independent, interchangeable modules.**

### Module Principles

1. **High Cohesion**: Module elements are closely related
2. **Low Coupling**: Modules have minimal dependencies on each other
3. **Clear Interfaces**: Module boundaries are well-defined
4. **Single Purpose**: Each module has one clear responsibility

### Bad Example - Monolithic

```typescript
// ❌ BAD - Everything in one giant file (users.ts)

// Authentication logic
function login(email, password) { }
function logout(token) { }
function verifyToken(token) { }

// User management
function createUser(data) { }
function updateUser(id, data) { }
function deleteUser(id) { }

// User profile
function getProfile(userId) { }
function updateProfile(userId, data) { }

// User notifications
function sendNotification(userId, message) { }
function getNotifications(userId) { }

// User search
function searchUsers(query) { }
function advancedSearch(filters) { }

// User analytics
function getUserStats(userId) { }
function generateReport(userId) { }
```

### Good Example - Modular

```
src/
├── modules/
│   ├── auth/
│   │   ├── auth.service.ts
│   │   ├── auth.controller.ts
│   │   ├── token.service.ts
│   │   └── auth.types.ts
│   │
│   ├── users/
│   │   ├── user.entity.ts
│   │   ├── user.repository.ts
│   │   ├── user.service.ts
│   │   ├── user.controller.ts
│   │   └── user.types.ts
│   │
│   ├── profiles/
│   │   ├── profile.service.ts
│   │   ├── profile.controller.ts
│   │   └── profile.types.ts
│   │
│   ├── notifications/
│   │   ├── notification.service.ts
│   │   ├── notification.repository.ts
│   │   └── notification.types.ts
│   │
│   └── analytics/
│       ├── analytics.service.ts
│       ├── report.generator.ts
│       └── analytics.types.ts
```

```typescript
// ✅ GOOD - Modular structure

// auth/auth.service.ts - Authentication module
export class AuthService {
  login(email: string, password: string): Promise<AuthToken>
  logout(token: string): Promise<void>
  verifyToken(token: string): Promise<boolean>
}

// users/user.service.ts - User management module
export class UserService {
  createUser(data: CreateUserDTO): Promise<User>
  updateUser(id: string, data: UpdateUserDTO): Promise<User>
  deleteUser(id: string): Promise<void>
}

// profiles/profile.service.ts - Profile module
export class ProfileService {
  getProfile(userId: string): Promise<Profile>
  updateProfile(userId: string, data: ProfileData): Promise<Profile>
}

// notifications/notification.service.ts - Notifications module
export class NotificationService {
  sendNotification(userId: string, message: string): Promise<void>
  getNotifications(userId: string): Promise<Notification[]>
}
```

### Module Communication

Modules communicate through **well-defined interfaces**, not direct coupling.

```typescript
// ❌ BAD - Direct coupling
class OrderService {
  async createOrder(orderData) {
    // Direct access to another module's internals
    await db.users.query('SELECT * FROM users WHERE id = ?', [orderData.userId]);
    await db.inventory.update({ ... });
    await emailService.sendEmail({ ... });
  }
}

// ✅ GOOD - Through interfaces
interface IUserRepository {
  findById(id: string): Promise<User | null>;
}

interface IInventoryService {
  reserveItems(items: OrderItem[]): Promise<void>;
}

interface INotificationService {
  notifyOrderCreated(order: Order): Promise<void>;
}

class OrderService {
  constructor(
    private userRepository: IUserRepository,
    private inventoryService: IInventoryService,
    private notificationService: INotificationService
  ) {}

  async createOrder(orderData: CreateOrderDTO): Promise<Order> {
    const user = await this.userRepository.findById(orderData.userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    await this.inventoryService.reserveItems(orderData.items);

    const order = new Order(orderData);
    await this.orderRepository.save(order);

    await this.notificationService.notifyOrderCreated(order);

    return order;
  }
}
```

### Benefits of Modularity

1. **Reusability**: Modules can be used in different contexts
2. **Testability**: Modules can be tested in isolation
3. **Team Scalability**: Different teams can own different modules
4. **Maintainability**: Changes are localized to specific modules
5. **Replaceability**: Modules can be swapped without affecting others

---

## Dependency Injection

**Inject dependencies rather than creating them internally.**

```typescript
// ❌ BAD - Hard-coded dependencies
class UserService {
  private repository = new UserRepository();  // Tightly coupled
  private emailService = new EmailService();  // Can't test or swap

  async createUser(data: UserData) {
    await this.repository.save(data);
    await this.emailService.send(data.email);
  }
}

// ✅ GOOD - Injected dependencies
class UserService {
  constructor(
    private repository: IUserRepository,
    private emailService: IEmailService
  ) {}

  async createUser(data: UserData) {
    await this.repository.save(data);
    await this.emailService.send(data.email);
  }
}

// Easy to test with mocks
const mockRepository = { save: jest.fn() };
const mockEmailService = { send: jest.fn() };
const service = new UserService(mockRepository, mockEmailService);
```

---

## Code Quality Standards

### Readability

Code is read 10x more than it's written. Optimize for readers.

**Variable Naming**:
- ✅ Descriptive: `userData`, `isAuthenticated`, `maxRetryCount`
- ❌ Cryptic: `x`, `tmp`, `data`, `result`, `obj`

**Function Length**:
- **Maximum**: 50 lines
- Exceptions require justification
- If longer, split into smaller functions

**Comments**:
- Explain **WHY**, not WHAT
- Complex algorithms need explanation
- Edge case handling should be documented
- No commented-out code (use git history)

### No Magic Numbers

```typescript
// ✅ GOOD
const MAX_LOGIN_ATTEMPTS = 5;
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

if (attempts > MAX_LOGIN_ATTEMPTS) {
  lockAccount(user);
}

// ❌ BAD
if (attempts > 5) { // What is 5? Why 5?
  lockAccount(user);
}
```

---

## Security Standards

### Zero Tolerance

Security vulnerabilities are **UNACCEPTABLE**. Even small ones.

### Required Checks

**Injection Vulnerabilities**:
- [ ] No SQL injection (use parameterized queries)
- [ ] No command injection (sanitize shell inputs)
- [ ] No XSS (escape/sanitize HTML output)
- [ ] No path traversal (validate file paths)

**Authentication & Authorization**:
- [ ] Authentication enforced where needed
- [ ] Authorization checked (not just authentication)
- [ ] No privilege escalation paths

**Data Protection**:
- [ ] No secrets in code (use environment variables)
- [ ] No sensitive data in logs
- [ ] No credentials in error messages
- [ ] Passwords are hashed (never stored plaintext)

---

## Testing Standards

### Required Coverage

1. **Regression Test**: Proves the bug is fixed
2. **Edge Case Tests**: Tests for each edge case handled
3. **Error Condition Tests**: Tests for error paths
4. **Integration Tests**: Tests how components work together (if applicable)

### Test Naming

**Format**: `should [expected behavior] when [condition]`

✅ GOOD:
- `should return user when valid ID provided`
- `should throw NotFoundError when user does not exist`

❌ BAD:
- `test1`
- `it works`

---

## Error Handling Standards

### Be Defensive

Assume everything can fail. Handle it gracefully.

---

## Enforcement

These standards are enforced by:

1. **Adversarial Supervisor** - Reviews plans and implementations ruthlessly
2. **Quality Gates** - Automated checks (lint, test, build)
3. **Human Reviewers** - Final approval before merge

**No exceptions. No shortcuts. Excellence is non-negotiable.**
