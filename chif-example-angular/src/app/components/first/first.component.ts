import { Component, OnInit, Injectable, ViewEncapsulation } from '@angular/core';
import { WindowRef } from '../../service/WindowRef';

@Component({
  selector: 'app-first',
  templateUrl: './first.component.html',
  styleUrls: ['./first.component.css'],
 encapsulation: ViewEncapsulation.None
})

export class FirstComponent implements OnInit {
  window:any;
  constructor(winRef: WindowRef) {
    this.window = winRef.nativeWindow;
  }
  ngOnInit() {
    this.window.chifPlayer.streamFiles();
  }
}
