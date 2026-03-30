# TypeScript 编译器：从源代码到 Symbol 的完整关系

> 学习路径：**[1] 本文** → [2 JSON 与数据格式](json-basics.md) → [3 系统与运行环境](system-and-runtime-fundamentals.md) → [4 节点模型与序列化管线](figma-node-and-serialization-pipeline.md)
>
> 索引：[学习笔记导航](learning-index.md)

## 常见约定缩写

| 缩写 | 全称 | 含义 |
|------|------|------|
| `const` | constant | 常量（赋值后不能改） |
| `let` | let | 变量（可以重新赋值） |
| `var` | variable | 变量（旧写法，基本不用了） |
| `enum` | enumeration | 枚举 |
| `int` | integer | 整数 |
| `str` | string | 字符串 |
| `fn` / `func` | function | 函数 |
| `impl` | implementation | 实现 |
| `intf` | interface | 接口 |
| `decl` | declaration | 声明 |
| `ret` | return | 返回 |
| `bool` | boolean | 布尔值（true/false） |
| `param` | parameter | 参数 |
| `arg` | argument | 实参 |
| `props` | properties | 属性集合 |
| `ctx` | context | 上下文 |
| `err` | error | 错误 |
| `msg` | message | 消息 |
| `cb` | callback | 回调函数 |
| `async` | asynchronous | 异步 |

## 一个完整的例子

```typescript
// ═══════════════════════════════════════════════════
// 一段真实的 TypeScript 代码
// ═══════════════════════════════════════════════════

type ID = string;                         // 类型别名

interface Printable {                     // 接口
  print(): void;
}

enum Role {                               // 枚举
  Admin = "admin",
  User = "user",
}

class Employee implements Printable {     // 类
  name: string;                           // 属性
  role: Role;                             // 属性

  constructor(name: string, role: Role) { // 构造函数
    this.name = name;
    this.role = role;
  }

  print(): void {                         // 方法
    console.log(`${this.name} is ${this.role}`);
  }
}

function createEmployee(name: string): Employee {  // 函数
  return new Employee(name, Role.User);
}

const emp = createEmployee("Alice");      // 常量变量
emp.print();                               // 调用 print 方法，输出: Alice is user


// ═══════════════════════════════════════════════════
// 编译器对上面代码做了什么？
// ═══════════════════════════════════════════════════


// 【第一步：Parser 解析】源代码 → AST
// ─────────────────────────────────────
//
// Parser 把文本变成树，每个声明变成 AST 节点：
//
// SourceFile (根节点)
// ├── TypeAliasDeclaration        ← type ID = string
// ├── InterfaceDeclaration        ← interface Printable
// │   └── MethodSignature         ← print(): void
// ├── EnumDeclaration             ← enum Role
// │   ├── EnumMember              ← Admin
// │   └── EnumMember              ← User
// ├── ClassDeclaration            ← class Employee
// │   ├── PropertyDeclaration     ← name: string
// │   ├── PropertyDeclaration     ← role: Role
// │   ├── Constructor             ← constructor(...)
// │   └── MethodDeclaration       ← print(): void
// ├── FunctionDeclaration         ← function createEmployee
// └── VariableStatement           ← const emp = ...


// 【第二步：Binder 绑定】AST 节点 → Symbol + Flags
// ─────────────────────────────────────
//
// Binder 遍历 AST，为每个命名声明创建 Symbol，并打上 Flags 标签：
//
//  AST 节点                    → Symbol 名          Flags
//  ─────────────────────────  ──────────────────   ─────────────────
//  TypeAliasDeclaration       → "ID"               [Type]
//  InterfaceDeclaration       → "Printable"        [Type]
//  EnumDeclaration            → "Role"             [Value, Type]
//  EnumMember (Admin)         → "Admin"            [Value]
//  EnumMember (User)          → "User"             [Value]
//  ClassDeclaration           → "Employee"         [Value, Type]
//  PropertyDeclaration        → "name"             [Value]
//  PropertyDeclaration        → "role"             [Value]
//  Constructor                → "constructor"      [Value]
//  MethodDeclaration          → "print"            [Value]
//  FunctionDeclaration        → "createEmployee"   [Value]
//  VariableStatement          → "emp"              [Value]


// 【第三步：Checker 类型检查】用 Symbol + Flags 验证代码
// ─────────────────────────────────────
//
// 场景 1：Employee 同时有 Value 和 Type 两个 flag
//
//   const e = new Employee("Bob", Role.Admin);
//                  ^^^^^^^^
//                  查 Symbol "Employee" → flags 有 Value？✓ 可以 new
//
//   let person: Employee;
//               ^^^^^^^^
//               查 Symbol "Employee" → flags 有 Type？✓ 可以当类型
//
// 场景 2：ID 只有 Type flag
//
//   let userId: ID = "abc";
//               ^^
//               查 Symbol "ID" → flags 有 Type？✓ 可以当类型
//
//   const x = new ID();
//                  ^^
//                  查 Symbol "ID" → flags 有 Value？✗ 报错！
//                  Error: 'ID' only refers to a type, but is being used as a value here.
//
// 场景 3：Role 同时有 Value 和 Type 两个 flag
//
//   let r: Role = Role.Admin;
//          ^^^^   ^^^^
//          Type✓  Value✓     两种用法都合法


// 【Flags 位运算原理】
// ─────────────────────────────────────
//
//  enum SymbolFlags {
//    Value = 0b01,    // 二进制第 1 位
//    Type  = 0b10,    // 二进制第 2 位
//  }
//
//  "ID"         → flags = 0b10         只有 Type
//  "emp"        → flags = 0b01         只有 Value
//  "Employee"   → flags = 0b01 | 0b10  = 0b11  Value + Type
//  "Role"       → flags = 0b01 | 0b10  = 0b11  Value + Type
//
//  检测方法：
//    flags & Value  →  0b11 & 0b01  =  0b01  → 真，是值
//    flags & Type   →  0b11 & 0b10  =  0b10  → 真，是类型
//    flags & Value  →  0b10 & 0b01  =  0b00  → 假，不是值（比如 type ID）


// 【完整流程】
// ─────────────────────────────────────
//
//  源代码         → [Parser]  → AST          → [Binder]  → Symbol + Flags → [Checker] → 结果
//
//  class Employee → 解析       → ClassDecl    → 绑定       → "Employee"      → 检查      → ✓
//                                               节点          [Value, Type]
//
//  type ID        → 解析       → TypeAlias    → 绑定       → "ID"            → 检查      → ✓/✗
//                                               节点          [Type]            new ID() 报错
```

## 变量与常量的认知

- `const emp = createEmployee("Alice")` 做了两件事：创建对象 + 起名字
- `emp` 只是名字，本身没功能，真正发挥作用的是前面的声明（class、function）和调用（.print()）
- 起名字的目的是复用——后面再用到这个对象时，写 `emp` 代替 `createEmployee("Alice")`
- `const`（常量）= 名字绑死，不能改指向；`let`（变量）= 名字可以改指向
- **const 锁的是指向（地址），不是内容**：
  - `emp.name = "Bob"` ✓ —— 地址没换，改里面的内容，const 不管
  - `emp = createEmployee("Bob")` ✗ —— 换地址了，const 拦住
  - 类比：const = 不能搬家，但家里家具随便换
  - 想连内容也锁，用 `Object.freeze()`
- **数学的常量 vs 代码的 const**：
  - 数学：值本身不变（π 永远是 3.14159...）
  - 代码：指向不变，值可能变
- 变量名是给开发者看的，程序不关心叫什么（emp、alice123、asdfgh 效果一样）
- 只有一个对象时用一个名字（`emp`），多个时才需要区分（`alice`、`bob`）
- 大量同类对象用数组 `[]` 或对象 `{}` 存，不会每个都起名字

## 易混淆概念澄清

| 容易搞混的 | 实际区别 |
|-----------|---------|
| `const` (constant) vs constraint | `const` = 常量，值不能改；constraint = 约束，编程中指接口/类型对代码的限制。拼写像但无关 |
| `interface` vs "用户界面" | `interface` 在代码里是**接口约束**（规定类必须实现哪些方法），不是用户看到的界面 |
| `class` vs `type` | `class` 是类（既能当值 `new`，又能当类型）；`type` 是纯类型别名（只能当类型，不能 `new`） |
| `print()` vs 打印到屏幕 | `print()` 只是方法名，不会自动执行。需要手动调用 `emp.print()` 才会输出 |
| `createEmployee("Alice")` | 函数内部写死了 `Role.User`，所以 Alice 的角色固定是 User，不是 Admin |
