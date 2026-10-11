import{describe,it,expect}from'vitest';import{hasVisualRequestConsent}from'../src/ai/visualSettings';
const connection={protocol:1,token:'a'.repeat(64),enabled:true,userConfirmed:true};const visual={version:1,enabled:true,userConfirmed:true};
describe('separate visual request consent',()=>{
 it('text AI consent alone leaves screenshots disabled',()=>expect(hasVisualRequestConsent(connection,undefined)).toBe(false));
 it('requires both independently valid settings',()=>expect(hasVisualRequestConsent(connection,visual)).toBe(true));
 it('visual consent without paired AI remains disabled',()=>expect(hasVisualRequestConsent(undefined,visual)).toBe(false));
 it('rejects incomplete or injected visual settings',()=>{expect(hasVisualRequestConsent(connection,{version:1,enabled:true})).toBe(false);expect(hasVisualRequestConsent(connection,{...visual,endpoint:'https://other.local'})).toBe(false)});
});
