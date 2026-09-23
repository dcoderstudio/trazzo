(function(){
 'use strict';
 var mobile=window.matchMedia('(max-width:900px)');
 var left=document.querySelector('.eq-left'),right=document.querySelector('.eq-right');
 var people=document.getElementById('mobilePeople'),goals=document.getElementById('mobileGoals');
 function set(panel,button,open){panel.classList.toggle('mobile-open',open);button.setAttribute('aria-expanded',String(open));}
 people.onclick=function(){var open=!left.classList.contains('mobile-open');set(right,goals,false);set(left,people,open);};
 goals.onclick=function(){var open=!right.classList.contains('mobile-open');set(left,people,false);set(right,goals,open);};
 // Selection handlers redraw the list, so use capture to identify the original row.
 left.addEventListener('click',function(e){
  if(!mobile.matches||e.target.closest('.eq-mdel,.eq-marea-btn,.eq-area-popup,button:not(#eqVgBtn)'))return;
  if(e.target.closest('.eq-mrow,.eq-arow,#eqVgBtn'))set(left,people,false);
 },true);
 document.addEventListener('keydown',function(e){if(e.key==='Escape'&&mobile.matches){if(left.classList.contains('mobile-open')){set(left,people,false);people.focus();}else if(right.classList.contains('mobile-open')){set(right,goals,false);goals.focus();}}});
 mobile.addEventListener('change',function(){set(left,people,false);set(right,goals,false);});
})();
