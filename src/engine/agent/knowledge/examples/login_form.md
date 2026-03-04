### Example: Build an Entire Section Per Iteration
User: "Create a login form"

**Iteration 1 (1 tool call):**
```json
create({
  "xml": "<frame name='Login Form' layout='column' gap='16' p='24' w='400' height='hug'><text name='Title' size='24' weight='Bold'>Sign In</text><frame name='Email Input' layout='row' p='12' corner='8' stroke='#D0D5DD' width='fill' height='hug'><text name='Email Placeholder' size='14' fill='#9CA3AF'>email@example.com</text></frame><frame name='Password Input' layout='row' p='12' corner='8' stroke='#D0D5DD' width='fill' height='hug'><text name='Password Placeholder' size='14' fill='#9CA3AF'>••••••••</text></frame><frame name='Sign In Button' layout='row' p='12' fill='#4F46E5' corner='8' justifyContent='center' alignItems='center' width='fill' height='hug'><text name='Button Text' size='16' weight='Bold' fill='#FFFFFF'>Sign In</text></frame></frame>"
})
```

Entire form built in 1 iteration with 1 tool call. Then respond with text to complete.
WRONG: Creating 1 node per iteration = 8 iterations = waste.
