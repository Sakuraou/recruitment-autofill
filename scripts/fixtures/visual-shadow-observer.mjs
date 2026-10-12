// Read-only layout fixtures run outside an extension. This test-only registry
// records all roots created in the controlled fixture, including closed roots.
// It is never included in an extension build or granted capture/send authority.
export const visualShadowObserverScript = `(()=>{
 const roots=new WeakMap(),attach=Element.prototype.attachShadow;
 Element.prototype.attachShadow=function(init){const root=attach.call(this,init);roots.set(this,root);return root};
 window.chrome={dom:{openOrClosedShadowRoot:element=>roots.get(element)??element.shadowRoot??null}};
})();`;
