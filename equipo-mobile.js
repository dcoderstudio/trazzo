(function(){
 'use strict';
 var mobile=window.matchMedia('(max-width:900px)');
 var left=document.querySelector('.eq-left'),right=document.querySelector('.eq-right');
 var people=document.getElementById('mobilePeople'),goals=document.getElementById('mobileGoals');
 var leftTab=document.getElementById('eqLeftTab');
 function set(panel,button,open){panel.classList.toggle('mobile-open',open);button.setAttribute('aria-expanded',String(open));}
 function setLeft(open){
  left.classList.toggle('mobile-open',open);
  people.setAttribute('aria-expanded',String(open));
  if(leftTab){leftTab.setAttribute('aria-expanded',String(open));leftTab.classList.toggle('open',open);}
 }
 people.onclick=function(){setLeft(!left.classList.contains('mobile-open'));set(right,goals,false);};
 goals.onclick=function(){var open=!right.classList.contains('mobile-open');setLeft(false);set(right,goals,open);};
 if(leftTab)leftTab.onclick=function(){setLeft(!left.classList.contains('mobile-open'));};
 // Selection handlers redraw the list, so use capture to identify the original row.
 // Closes the drawer on both mobile (sheet) and desktop (slide-out tab).
 left.addEventListener('click',function(e){
  if(e.target.closest('.eq-mdel,.eq-marea-btn,.eq-area-popup,button:not(#eqVgBtn)'))return;
  if(e.target.closest('.eq-mrow,.eq-arow,#eqVgBtn'))setLeft(false);
 },true);
 document.addEventListener('keydown',function(e){if(e.key!=='Escape')return;if(left.classList.contains('mobile-open')){setLeft(false);(mobile.matches?people:leftTab||people).focus();}else if(right.classList.contains('mobile-open')){set(right,goals,false);goals.focus();}});
 mobile.addEventListener('change',function(){setLeft(false);set(right,goals,false);});
})();
